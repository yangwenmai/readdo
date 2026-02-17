package model

import "encoding/json"

// ErrorInfo holds structured failure information for an Item.
type ErrorInfo struct {
	FailedStep string `json:"failed_step"`
	Message    string `json:"message"`
	Retryable  bool   `json:"retryable"`
	FailedAt   string `json:"failed_at"`
}

// ToJSON serializes ErrorInfo to a JSON string.
func (e ErrorInfo) ToJSON() string {
	b, _ := json.Marshal(e)
	return string(b)
}
