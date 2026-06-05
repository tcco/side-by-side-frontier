if user_id not in shared_state:
    await asyncio.sleep(0.1)   # <-- Context switch!
    shared_state[user_id] = 0