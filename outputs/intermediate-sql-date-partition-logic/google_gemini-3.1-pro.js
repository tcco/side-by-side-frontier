WITH cleaned_events AS (
    -- Step 1: Clean and standardize the raw data
    SELECT 
        event_id,
        user_id,
        -- Safely extract the date portion using regex to avoid casting errors on bad strings
        SUBSTRING(raw_timestamp FROM '^\d{4}-\d{2}-\d{2}')::DATE AS event_date,
        -- Standardize messy geo_payload into macro-regions
        CASE 
            WHEN geo_payload ILIKE '%US%' THEN 'US'
            WHEN geo_payload ILIKE '%EU%' THEN 'EU'
            ELSE 'OTHER' 
        END AS region
    FROM user_events
    WHERE 
        -- Filter out explicit NULLs and anomalous empty strings
        user_id IS NOT NULL 
        AND TRIM(user_id) != ''
        -- Ensure we only process rows with valid date strings
        AND SUBSTRING(raw_timestamp FROM '^\d{4}-\d{2}-\d{2}') IS NOT NULL
),

daily_active_users AS (
    -- Step 2: Calculate DAU per region, excluding weekends
    SELECT 
        region,
        event_date,
        COUNT(DISTINCT user_id) AS dau
    FROM cleaned_events
    WHERE 
        -- ISODOW: 1=Monday, ..., 6=Saturday, 7=Sunday. Filter out 6 and 7.
        EXTRACT(ISODOW FROM event_date) < 6
    GROUP BY 
        region, 
        event_date
),

date_bounds AS (
    -- Step 3: Find the global min and max dates to generate a calendar
    SELECT 
        MIN(event_date) AS min_date,
        MAX(event_date) AS max_date
    FROM cleaned_events
),

weekday_calendar AS (
    -- Step 4: Generate a continuous series of dates, filtering out weekends
    SELECT 
        generate_series.date::DATE AS event_date
    FROM date_bounds,
         GENERATE_SERIES(min_date, max_date, INTERVAL '1 day') AS generate_series(date)
    WHERE 
        EXTRACT(ISODOW FROM generate_series.date) < 6
),

region_calendar AS (
    -- Step 5: Cross join regions with the weekday calendar to ensure no missing days
    SELECT 
        wc.event_date,
        r.region
    FROM weekday_calendar wc
    CROSS JOIN (SELECT DISTINCT region FROM cleaned_events) r
),

dense_daily_users AS (
    -- Step 6: Join actual DAU to the dense calendar, filling missing days with 0
    SELECT 
        rc.region,
        rc.event_date,
        COALESCE(dau.dau, 0) AS dau
    FROM region_calendar rc
    LEFT JOIN daily_active_users dau 
        ON rc.region = dau.region 
        AND rc.event_date = dau.event_date
)

-- Step 7: Calculate the 30-weekday rolling average using native window functions
SELECT 
    region,
    event_date,
    dau AS daily_active_users,
    ROUND(
        AVG(dau) OVER (
            PARTITION BY region 
            ORDER BY event_date 
            -- Look back exactly 29 rows (plus current row = 30 days)
            ROWS BETWEEN 29 PRECEDING AND CURRENT ROW
        ), 2
    ) AS rolling_30_day_avg_dau
FROM dense_daily_users
ORDER BY 
    region, 
    event_date;