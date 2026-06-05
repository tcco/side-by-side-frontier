   if user_id not in shared_state:
       await asyncio.sleep(0.1) # <--- CONTEXT SWITCH
       shared_state[user_id] = 0
   ```
   If multiple requests for the same new `user_id` arrive concurrently, they all evaluate `user_id not in shared_state` as `True`. They all yield control at the `await`, and subsequently, all of them initialize the balance to `0`, potentially wiping out any updates that might have completed in the meantime.

2. **The Update Race (Lost Updates):**
   ```python
   current_balance = shared_state[user_id]
   await asyncio.sleep(0.05) # <--- CONTEXT SWITCH
   shared_state[user_id] = current_balance + amount
   ```
   If User A has a balance of `100`, and two requests to add `50` arrive simultaneously:
   * Task 1 reads `current_balance = 100` and hits the `await`.
   * Task 2 reads `current_balance = 100` and hits the `await`.
   * Task 1 resumes and writes `100 + 50 = 150`.
   * Task 2 resumes and writes `100 + 50 = 150`.
   
   The final balance is `150` instead of the correct `200`. The first update is silently overwritten.

---

### The Solution: Fine-Grained Asynchronous Locking

To fix this without creating a massive performance bottleneck, we must avoid using a single global lock. A global lock would serialize *all* payments across the entire system, destroying your asynchronous throughput. 

Instead, we implement **per-user locking** (lock striping). This ensures that concurrent requests for the *same* user are processed sequentially, while requests for *different* users continue to process entirely in parallel.

Here is the corrected code:
