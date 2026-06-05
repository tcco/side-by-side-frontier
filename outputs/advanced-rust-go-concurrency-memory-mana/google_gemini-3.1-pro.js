use std::future::Future;
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

/// A thread-safe, memory-bounded asynchronous batch processor.
pub struct BatchProcessor<T> {
    sender: mpsc::Sender<T>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    worker_handle: Option<JoinHandle<()>>,
}

impl<T: Send + 'static> BatchProcessor<T> {
    /// Creates a new BatchProcessor.
    ///
    /// * `capacity` - The maximum number of items the internal queue can hold (Backpressure).
    /// * `batch_size` - The maximum number of items per batch ($N$).
    /// * `timeout` - The maximum time to wait before flushing a partial batch ($T$).
    /// * `flush_handler` - An async closure that processes the flushed batches.
    pub fn new<F, Fut>(
        capacity: usize,
        batch_size: usize,
        timeout: Duration,
        mut flush_handler: F,
    ) -> Self
    where
        F: FnMut(Vec<T>) -> Fut + Send + 'static,
        Fut: Future<Output = ()> + Send,
    {
        assert!(capacity > 0, "Capacity must be greater than 0");
        assert!(batch_size > 0, "Batch size must be greater than 0");

        // Bounded channel for backpressure
        let (tx, mut rx) = mpsc::channel::<T>(capacity);
        // Oneshot channel for explicit shutdown signaling
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();

        let worker_handle = tokio::spawn(async move {
            let mut current_batch = Vec::with_capacity(batch_size);
            let sleep = tokio::time::sleep(timeout);
            tokio::pin!(sleep);
            let mut has_deadline = false;

            loop {
                tokio::select! {
                    // Condition 1: A new item arrives from a producer
                    maybe_item = rx.recv() => {
                        match maybe_item {
                            Some(item) => {
                                if current_batch.is_empty() {
                                    // Start the timeout clock when the first item is added
                                    sleep.as_mut().reset(tokio::time::Instant::now() + timeout);
                                    has_deadline = true;
                                }
                                
                                current_batch.push(item);
                                
                                // Flush if we hit the batch size N
                                if current_batch.len() >= batch_size {
                                    flush_handler(std::mem::replace(&mut current_batch, Vec::with_capacity(batch_size))).await;
                                    has_deadline = false;
                                }
                            }
                            None => {
                                // All senders were dropped unexpectedly
                                if !current_batch.is_empty() {
                                    flush_handler(current_batch).await;
                                }
                                break;
                            }
                        }
                    }
                    
                    // Condition 2: The timeout T expires (only active if batch is not empty)
                    _ = &mut sleep, if has_deadline => {
                        flush_handler(std::mem::replace(&mut current_batch, Vec::with_capacity(batch_size))).await;
                        has_deadline = false;
                    }
                    
                    // Condition 3: Explicit shutdown requested
                    _ = &mut shutdown_rx => {
                        // Close the receiver to prevent new items from entering the queue
                        rx.close();
                        
                        // Drain all remaining items already in the queue
                        while let Some(item) = rx.recv().await {
                            current_batch.push(item);
                            if current_batch.len() >= batch_size {
                                flush_handler(std::mem::replace(&mut current_batch, Vec::with_capacity(batch_size))).await;
                            }
                        }
                        
                        // Flush any final partial batch
                        if !current_batch.is_empty() {
                            flush_handler(current_batch).await;
                        }
                        break;
                    }
                }
            }
        });

        Self {
            sender: tx,
            shutdown_tx: Some(shutdown_tx),
            worker_handle: Some(worker_handle),
        }
    }

    /// Returns a cloneable sender that producers can use to send items.
    pub fn sender(&self) -> mpsc::Sender<T> {
        self.sender.clone()
    }

    /// Gracefully shuts down the processor, ensuring all buffered items are flushed.
    pub async fn shutdown(mut self) {
        // Signal the worker to shut down
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        // Wait for the worker to finish draining and flushing
        if let Some(handle) = self.worker_handle.take() {
            let _ = handle.await;
        }
    }
}