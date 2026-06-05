package main

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

var ErrClosed = errors.New("batch processor is shut down")

type BatchHandler[T any] func(batch []T) error

type BatchProcessor[T any] struct {
	in           chan T
	batchSize    int
	flushTimeout time.Duration
	handler      BatchHandler[T]

	mu     sync.RWMutex
	closed bool

	shutdownOnce sync.Once
	done         chan struct{}

	errMu sync.Mutex
	err   error
}

func NewBatchProcessor[T any](
	batchSize int,
	flushTimeout time.Duration,
	queueCapacity int,
	handler BatchHandler[T],
) (*BatchProcessor[T], error) {
	if batchSize <= 0 {
		return nil, errors.New("batchSize must be > 0")
	}
	if flushTimeout <= 0 {
		return nil, errors.New("flushTimeout must be > 0")
	}
	if queueCapacity < 0 {
		return nil, errors.New("queueCapacity must be >= 0")
	}
	if handler == nil {
		return nil, errors.New("handler must not be nil")
	}

	bp := &BatchProcessor[T]{
		in:           make(chan T, queueCapacity),
		batchSize:    batchSize,
		flushTimeout: flushTimeout,
		handler:      handler,
		done:         make(chan struct{}),
	}

	go bp.run()

	return bp, nil
}

func (bp *BatchProcessor[T]) Submit(item T) error {
	return bp.SubmitContext(context.Background(), item)
}

func (bp *BatchProcessor[T]) SubmitContext(ctx context.Context, item T) error {
	if ctx == nil {
		ctx = context.Background()
	}

	/*
		The read lock prevents Shutdown from closing the input channel while this
		goroutine may still send into it.

		If the queue is full, this blocks here, providing backpressure.
	*/
	bp.mu.RLock()
	defer bp.mu.RUnlock()

	if bp.closed {
		return ErrClosed
	}

	select {
	case bp.in <- item:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (bp *BatchProcessor[T]) Shutdown() error {
	bp.shutdownOnce.Do(func() {
		/*
			The write lock waits for all active Submit calls to finish before
			closing the channel, preventing send-on-closed-channel panics.
		*/
		bp.mu.Lock()
		bp.closed = true
		close(bp.in)
		bp.mu.Unlock()
	})

	<-bp.done
	return bp.Err()
}

func (bp *BatchProcessor[T]) Err() error {
	bp.errMu.Lock()
	defer bp.errMu.Unlock()
	return bp.err
}

func (bp *BatchProcessor[T]) recordErr(err error) {
	if err == nil {
		return
	}

	bp.errMu.Lock()
	defer bp.errMu.Unlock()

	if bp.err == nil {
		bp.err = err
	}
}

func (bp *BatchProcessor[T]) run() {
	defer close(bp.done)

	batch := make([]T, 0, bp.batchSize)

	var timer *time.Timer
	var timerC <-chan time.Time

	stopTimer := func() {
		if timer == nil {
			return
		}

		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}

		timer = nil
		timerC = nil
	}

	startTimer := func() {
		timer = time.NewTimer(bp.flushTimeout)
		timerC = timer.C
	}

	flush := func() {
		if len(batch) == 0 {
			return
		}

		/*
			Transfer ownership of the current batch slice to the handler.
			A fresh slice is created for the next batch, so the handler may safely
			retain or mutate the passed slice if needed.
		*/
		toFlush := batch
		batch = make([]T, 0, bp.batchSize)

		stopTimer()

		if err := bp.handler(toFlush); err != nil {
			bp.recordErr(err)
		}
	}

	for {
		if len(batch) == 0 {
			item, ok := <-bp.in
			if !ok {
				return
			}

			batch = append(batch, item)

			if len(batch) >= bp.batchSize {
				flush()
			} else {
				startTimer()
			}

			continue
		}

		select {
		case item, ok := <-bp.in:
			if !ok {
				flush()
				return
			}

			batch = append(batch, item)

			if len(batch) >= bp.batchSize {
				flush()
			}

		case <-timerC:
			flush()
		}
	}
}

func main() {
	processor, err := NewBatchProcessor[int](
		5,
		250*time.Millisecond,
		10,
		func(batch []int) error {
			fmt.Println("flushed:", batch)
			return nil
		},
	)
	if err != nil {
		panic(err)
	}

	var producers sync.WaitGroup

	for producerID := 0; producerID < 3; producerID++ {
		producers.Add(1)

		go func(id int) {
			defer producers.Done()

			for i := 0; i < 7; i++ {
				item := id*100 + i

				if err := processor.Submit(item); err != nil {
					fmt.Println("submit failed:", err)
					return
				}
			}
		}(producerID)
	}

	producers.Wait()

	if err := processor.Shutdown(); err != nil {
		fmt.Println("processor completed with handler error:", err)
	}

	fmt.Println("shutdown complete")
}