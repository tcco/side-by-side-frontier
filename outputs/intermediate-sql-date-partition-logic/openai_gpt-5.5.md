```sql
WITH normalized AS (
    SELECT
        event_id,

        /* Treat blank strings and literal NULL-like values as NULL users */
        CASE
            WHEN user_id IS NULL THEN NULL
            WHEN btrim(user_id) = '' THEN NULL
            WHEN upper(btrim(user_id)) IN ('NULL', 'N/A', 'NA') THEN NULL
            ELSE btrim(user_id)
        END AS clean_user_id,

        /* Normalize geo string before mapping */
        regexp_replace(
            upper(btrim(coalesce(geo_payload, ''))),
            '[^A-Z0-9]+',
            '_',
            'g'
        ) AS normalized_geo,

        upper(btrim(raw_timestamp)) AS ts_txt
    FROM user_events
),

standardized AS (
    SELECT
        event_id,
        clean_user_id,

        CASE
            WHEN normalized_geo IN ('US', 'USA', 'UNITED_STATES')
              OR normalized_geo LIKE 'US_%'
              OR normalized_geo LIKE 'USA_%'
                THEN 'US'

            WHEN normalized_geo IN ('EU', 'EUR', 'EUROPE')
              OR normalized_geo LIKE 'EU_%'
              OR normalized_geo LIKE 'EUR_%'
                THEN 'EU'

            ELSE 'OTHER'
        END AS region,

        ts_txt
    FROM normalized
),

timestamp_parts AS (
    SELECT
        s.*,

        /*
          Supported examples:
          - 2024-01-15 13:45:20
          - 2024-01-15T13:45:20Z
          - 2024-01-15T13:45:20.123Z
          - 2024-01-15T13:45:20+02:00
          - 2024-01-15T13:45:20-0500

          Bad strings do not get cast directly.
        */
        regexp_match(
            ts_txt,
            '^([0-9]{4})-([0-9]{2})-([0-9]{2})[ T]([0-9]{2}):([0-9]{2}):([0-9]{2}(\.[0-9]{1,6})?)(Z|[+-]([01][0-9]|2[0-3]):?[0-5][0-9])?$'
        ) AS p
    FROM standardized s
),

typed_timestamp_parts AS (
    SELECT
        event_id,
        clean_user_id,
        region,

        p[1]::int     AS yyyy,
        p[2]::int     AS mm,
        p[3]::int     AS dd,
        p[4]::int     AS hh24,
        p[5]::int     AS mi,
        p[6]::numeric AS ss,
        p[8]          AS tz_txt
    FROM timestamp_parts
),

validated_timestamp_parts AS (
    SELECT
        *,

        CASE
            WHEN mm IN (1, 3, 5, 7, 8, 10, 12) THEN 31
            WHEN mm IN (4, 6, 9, 11) THEN 30
            WHEN mm = 2
             AND (
                    yyyy % 400 = 0
                    OR yyyy % 4 = 0 AND yyyy % 100 <> 0
                 )
                THEN 29
            WHEN mm = 2 THEN 28
            ELSE NULL
        END AS max_day_in_month,

        CASE
            WHEN tz_txt IS NULL OR tz_txt = 'Z' THEN 0
            ELSE
                CASE WHEN left(tz_txt, 1) = '-' THEN -1 ELSE 1 END
                *
                (
                    substring(regexp_replace(substring(tz_txt FROM 2), ':', '', 'g') FROM 1 FOR 2)::int * 60
                    +
                    substring(regexp_replace(substring(tz_txt FROM 2), ':', '', 'g') FROM 3 FOR 2)::int
                )
        END AS tz_offset_minutes
    FROM typed_timestamp_parts
),

parsed_events AS (
    SELECT
        event_id,
        clean_user_id,
        region,

        CASE
            WHEN yyyy IS NOT NULL
             AND mm BETWEEN 1 AND 12
             AND dd BETWEEN 1 AND max_day_in_month
             AND hh24 BETWEEN 0 AND 23
             AND mi BETWEEN 0 AND 59
             AND ss >= 0
             AND ss < 60
            THEN
                /*
                  Canonicalize offset-aware timestamps to UTC.
                  Plain timestamps are treated as already UTC/naive.
                */
                make_timestamp(
                    yyyy,
                    mm,
                    dd,
                    hh24,
                    mi,
                    ss::double precision
                )
                - coalesce(tz_offset_minutes, 0) * interval '1 minute'
            ELSE NULL
        END AS parsed_timestamp_utc
    FROM validated_timestamp_parts
),

valid_user_events AS (
    SELECT
        parsed_timestamp_utc::date AS event_date,
        region,
        clean_user_id
    FROM parsed_events
    WHERE parsed_timestamp_utc IS NOT NULL
      AND clean_user_id IS NOT NULL
),

daily_dau AS (
    SELECT
        event_date AS business_date,
        region,
        count(DISTINCT clean_user_id) AS dau
    FROM valid_user_events
    WHERE extract(isodow FROM event_date) BETWEEN 1 AND 5
    GROUP BY
        event_date,
        region
),

bounds AS (
    SELECT
        min(event_date) AS start_date,
        max(event_date) AS end_date
    FROM valid_user_events
),

regions AS (
    SELECT DISTINCT region
    FROM valid_user_events
),

weekday_calendar AS (
    SELECT
        gs::date AS business_date
    FROM bounds b
    CROSS JOIN LATERAL generate_series(
        b.start_date,
        b.end_date,
        interval '1 day'
    ) AS gs
    WHERE b.start_date IS NOT NULL
      AND extract(isodow FROM gs::date) BETWEEN 1 AND 5
),

region_weekday_spine AS (
    SELECT
        c.business_date,
        r.region
    FROM weekday_calendar c
    CROSS JOIN regions r
),

filled_daily_dau AS (
    SELECT
        s.business_date,
        s.region,
        coalesce(d.dau, 0)::bigint AS dau
    FROM region_weekday_spine s
    LEFT JOIN daily_dau d
        ON d.business_date = s.business_date
       AND d.region = s.region
)

SELECT
    business_date,
    region,
    dau,

    avg(dau::numeric) OVER (
        PARTITION BY region
        ORDER BY business_date::timestamp
        RANGE BETWEEN interval '29 days' PRECEDING AND CURRENT ROW
    ) AS rolling_30_day_weekday_avg_dau,

    count(*) OVER (
        PARTITION BY region
        ORDER BY business_date::timestamp
        RANGE BETWEEN interval '29 days' PRECEDING AND CURRENT ROW
    ) AS weekdays_in_30_day_window

FROM filled_daily_dau
ORDER BY
    region,
    business_date;
```

### Date windowing logic

The query first builds a complete weekday calendar using `generate_series`, excluding Saturdays and Sundays with:

```sql
extract(isodow FROM date) BETWEEN 1 AND 5
```

It then cross joins that weekday calendar to every standardized region, creating a continuous region/date spine. Daily DAU is left joined onto that spine, and missing weekday activity is filled with `0`.

The rolling average uses:

```sql
RANGE BETWEEN interval '29 days' PRECEDING AND CURRENT ROW
```

Because the underlying spine contains only weekdays, weekends are excluded from the rolling calculation. Because the spine includes weekdays even when a region has no users, zero-DAU weekdays are still counted in the average and do not break the rolling window continuity.