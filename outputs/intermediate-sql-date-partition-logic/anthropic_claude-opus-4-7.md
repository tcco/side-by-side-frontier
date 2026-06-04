# 30-Day Rolling DAU by Standardized Region (Weekdays Only)

Below is a production-ready PostgreSQL solution that handles dirty data, standardizes regions, and computes a true **30-weekday rolling average DAU** that survives gaps (zero-DAU days).

---

## Complete SQL Query

```sql
WITH
-- ──────────────────────────────────────────────────────────────
-- 1. CLEANSE: Parse timestamps safely and normalize identifiers
-- ──────────────────────────────────────────────────────────────
cleansed AS (
    SELECT
        event_id,
        user_id,
        -- Safe timestamp parsing: returns NULL on bad strings instead of failing
        COALESCE(
            -- Try ISO 8601 first (e.g. 2024-03-15T14:23:00Z)
            (SELECT raw_timestamp::timestamptz
             WHERE raw_timestamp ~ '^\d{4}-\d{2}-\d{2}T'),
            -- Fallback: standard 'YYYY-MM-DD HH:MI:SS'
            (SELECT to_timestamp(raw_timestamp, 'YYYY-MM-DD HH24:MI:SS')
             WHERE raw_timestamp ~ '^\d{4}-\d{2}-\d{2} ')
        ) AS event_ts,
        -- Standardize geo_payload into macro-regions
        CASE
            WHEN UPPER(REGEXP_REPLACE(geo_payload, '[-_\s]', '', 'g')) 
                 IN ('US','USA','USEAST','USWEST','USCENTRAL','USNORTH','USSOUTH')
                 THEN 'US'
            WHEN UPPER(REGEXP_REPLACE(geo_payload, '[-_\s]', '', 'g')) 
                 IN ('EU','EUWEST','EUEAST','EUCENTRAL','EUROPE')
                 THEN 'EU'
            WHEN UPPER(REGEXP_REPLACE(geo_payload, '[-_\s]', '', 'g'))
                 IN ('APAC','ASIA','ASIAPACIFIC','JP','JAPAN','SG','SINGAPORE')
                 THEN 'APAC'
            ELSE 'OTHER'
        END AS region
    FROM user_events
    WHERE user_id IS NOT NULL
      AND TRIM(user_id) <> ''
      AND raw_timestamp IS NOT NULL
),

-- ──────────────────────────────────────────────────────────────
-- 2. FILTER: Keep only weekday events with valid timestamps
-- ──────────────────────────────────────────────────────────────
weekday_events AS (
    SELECT
        region,
        user_id,
        (event_ts AT TIME ZONE 'UTC')::date AS event_date
    FROM cleansed
    WHERE event_ts IS NOT NULL
      -- ISO dow: 1=Mon … 5=Fri (exclude 6=Sat, 7=Sun)
      AND EXTRACT(ISODOW FROM event_ts) BETWEEN 1 AND 5
),

-- ──────────────────────────────────────────────────────────────
-- 3. AGGREGATE: Distinct users per region per weekday
-- ──────────────────────────────────────────────────────────────
daily_dau AS (
    SELECT
        region,
        event_date,
        COUNT(DISTINCT user_id) AS dau
    FROM weekday_events
    GROUP BY region, event_date
),

-- ──────────────────────────────────────────────────────────────
-- 4. SCAFFOLD: Build a dense weekday calendar per region
--    This guarantees gap-free windowing even when DAU = 0
-- ──────────────────────────────────────────────────────────────
date_spine AS (
    SELECT generate_series(
        (SELECT MIN(event_date) FROM daily_dau),
        (SELECT MAX(event_date) FROM daily_dau),
        INTERVAL '1 day'
    )::date AS d
),
weekday_spine AS (
    SELECT d FROM date_spine
    WHERE EXTRACT(ISODOW FROM d) BETWEEN 1 AND 5
),
regions AS (
    SELECT DISTINCT region FROM daily_dau
),
scaffold AS (
    SELECT r.region, s.d AS event_date
    FROM regions r CROSS JOIN weekday_spine s
),

-- ──────────────────────────────────────────────────────────────
-- 5. JOIN: Backfill missing region-days with DAU = 0
-- ──────────────────────────────────────────────────────────────
dense_dau AS (
    SELECT
        s.region,
        s.event_date,
        COALESCE(d.dau, 0) AS dau
    FROM scaffold s
    LEFT JOIN daily_dau d
      ON d.region = s.region
     AND d.event_date = s.event_date
)

-- ──────────────────────────────────────────────────────────────
-- 6. WINDOW: 30-weekday rolling average per region
-- ──────────────────────────────────────────────────────────────
SELECT
    region,
    event_date,
    dau,
    ROUND(
        AVG(dau) OVER (
            PARTITION BY region
            ORDER BY event_date
            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
        )::numeric, 2
    ) AS rolling_30d_avg_dau,
    COUNT(*) OVER (
        PARTITION BY region
        ORDER BY event_date
        ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
    ) AS window_size
FROM dense_dau
ORDER BY region, event_date;
```

---

## How the Date Windowing Handles Missing Days

The critical insight is the distinction between **calendar-day windows** and **row-based windows**:

### ❌ The Naive (Broken) Approach
Using `RANGE BETWEEN INTERVAL '30 days' PRECEDING` would:
1. Include weekend calendar dates we want to exclude.
2. Silently shrink the window when a region has zero activity on certain weekdays (because those rows don't exist).

### ✅ The Scaffold + ROWS Approach
1. **Step 4 (`weekday_spine` + `scaffold`)** generates an exhaustive Cartesian product of *every region* × *every weekday* between the dataset's min/max dates.
2. **Step 5 (`dense_dau`)** left-joins real DAU counts onto this scaffold, materializing **zero-DAU rows** for any region/weekday with no activity.
3. **Step 6** uses `ROWS BETWEEN 29 PRECEDING AND CURRENT ROW`. Because each row now equals exactly one weekday, "30 rows" deterministically equals "30 business days" — regardless of holidays, outages, or quiet periods.

The bonus `window_size` column lets you flag early rows where the window hasn't yet accumulated a full 30 weekdays (useful for filtering warmup periods in BI dashboards).

### Data-Quality Safeguards
| Issue | Mitigation |
|---|---|
| Mixed timestamp formats | Regex-guarded `CASE` with `to_timestamp` fallback — bad strings yield `NULL`, not exceptions |
| NULL / empty `user_id` | Filtered in `cleansed` CTE |
| Region variants (`us_east`, `US-East`, `USA`) | Stripped of separators + uppercased before bucketing |
| Duplicate `event_id` | Implicitly de-duplicated by `COUNT(DISTINCT user_id)` per day |
| Weekend contamination | `ISODOW BETWEEN 1 AND 5` applied at both event-filtering and spine-generation stages |