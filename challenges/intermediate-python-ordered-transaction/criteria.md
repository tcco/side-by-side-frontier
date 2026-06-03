Target: Data structuring, state mutation, and precise error handling.

How to Judge the Output:

Order Preservation: Does the logic iterate sequentially and build the batches properly, or does it try to sort or optimize the packing (which violates the order constraint)?

The Exception Trigger: Did it explicitly check for the ValueError condition before attempting to append, or does it fail silently/infinitely loop?

Empty States: If an empty list of transactions is provided, does it return an empty list of lists cleanly, or does it throw an index error trying to append to a non-existent first batch?