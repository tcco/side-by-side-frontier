Act as a Senior Backend Engineer debugging a high-throughput asynchronous system. I am encountering data corruption under load in a Python asyncio task execution layer.

Symptom / Context:
Under heavy concurrent load, multiple requests for the same user_id arrive simultaneously. Users report that their balance updates are occasionally missing or overwritten instead of accumulating. No explicit exception or traceback is thrown in the application console.

Task:

Diagnose the exact root cause of this logical concurrency issue based on the provided code and symptom.

Provide the corrected code fixing the issue without converting the function into a synchronous, blocking call.

Explain why your fix resolves the race condition without creating a massive performance bottleneck.