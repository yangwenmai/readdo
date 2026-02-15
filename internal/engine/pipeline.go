package engine

import (
	"context"

	"github.com/yangwenmai/readdo/internal/model"
)

// Pipeline orchestrates the execution of a sequence of Steps for an item.
type Pipeline struct {
	steps []Step
}

// NewPipeline creates a pipeline with the given steps, executed in order.
func NewPipeline(steps ...Step) *Pipeline {
	return &Pipeline{steps: steps}
}

// Run executes all pipeline steps for the given item.
// On success it returns nil. On failure it returns a *StepError indicating
// which step failed.
func (p *Pipeline) Run(ctx context.Context, item *model.Item) error {
	sc := &StepContext{Item: item}
	for _, step := range p.steps {
		if err := step.Run(ctx, sc); err != nil {
			return &StepError{Step: step.Name(), Err: err}
		}
	}
	return nil
}

// StepError wraps an error with the step name that failed.
type StepError struct {
	Step string
	Err  error
}

func (e *StepError) Error() string {
	return e.Step + ": " + e.Err.Error()
}

func (e *StepError) Unwrap() error {
	return e.Err
}

// StepName returns the name of the step that failed.
// This satisfies the stepNamer interface used by the worker package.
func (e *StepError) StepName() string {
	return e.Step
}
