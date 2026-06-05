current_balance = shared_state[user_id]
await asyncio.sleep(0.05)
shared_state[user_id] = current_balance + amount