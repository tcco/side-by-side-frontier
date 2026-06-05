import asyncio

shared_state = {}

async def process_payment(user_id, amount):
    if user_id not in shared_state:
        # Simulate an asynchronous database lookup or verification
        await asyncio.sleep(0.1)
        shared_state[user_id] = 0
    
    # Simulate processing balance updates
    current_balance = shared_state[user_id]
    await asyncio.sleep(0.05)
    shared_state[user_id] = current_balance + amount