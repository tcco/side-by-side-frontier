Act as an expert Data Engineer. I need a production-ready SQL query written in PostgreSQL dialect based on a messy, unnormalized transaction log table named `user_events`. 

Table Schema:
- `event_id` (VARCHAR, may contain duplicates)
- `raw_timestamp` (VARCHAR, mixed formats like 'YYYY-MM-DD HH:MI:SS' and ISO strings)
- `user_id` (VARCHAR, contains explicit NULL values and anomalous empty strings)
- `geo_payload` (VARCHAR, unnormalized string data e.g., 'US-East', 'us_east', 'USA', 'EU_WEST')

Task:
Write a query to calculate the 30-day rolling average of Daily Active Users (DAU), partitioned by a standardized region, explicitly excluding weekends (Saturdays and Sundays) from both the rolling window calculation and the active day count.

Constraints:
1. Standardize the `geo_payload` into clean, unified macro-regions (e.g., 'US', 'EU').
2. Clean and parse `raw_timestamp` safely into a standard timestamp without failing on bad strings.
3. Use native window functions instead of deeply nested, inefficient correlated subqueries.
4. Ensure that if a region has zero active users on a given weekday, it does not break the 30-day continuous window logic for subsequent active days.

Output: Provide the complete SQL query and a brief explanation of how your date windowing logic handles missing days.