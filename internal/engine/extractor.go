package engine

import (
	"context"
	"fmt"
	"io"
	"net/http"
	nurl "net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-shiori/go-readability"
)

const (
	maxTextLength = 15000
	// minTextLength is the minimum content length to accept as a valid extraction.
	// Pages returning less than this are likely login walls, cookie walls, or empty pages.
	minTextLength = 100
	// maxRetries is the number of extraction attempts before giving up.
	maxRetries = 3
	// maxBodySize is the maximum HTTP response body size (5MB).
	maxBodySize = 5 * 1024 * 1024
)

// HTTPExtractor fetches web pages and extracts readable content using go-readability.
type HTTPExtractor struct {
	client *http.Client
}

// NewHTTPExtractor creates a new HTTP-based content extractor.
func NewHTTPExtractor() *HTTPExtractor {
	return &HTTPExtractor{
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

// Extract fetches the URL and extracts the main content with automatic retry.
func (e *HTTPExtractor) Extract(ctx context.Context, url string) (*ExtractedContent, error) {
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		if attempt > 0 {
			backoff := time.Duration(attempt) * 2 * time.Second
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(backoff):
			}
		}

		content, err := e.doExtract(ctx, url)
		if err == nil {
			return content, nil
		}
		lastErr = err

		// Don't retry on context cancellation or non-retryable errors.
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, fmt.Errorf("after %d attempts: %w", maxRetries, lastErr)
}

// doExtract performs a single extraction attempt.
func (e *HTTPExtractor) doExtract(ctx context.Context, url string) (*ExtractedContent, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Use a realistic browser User-Agent to avoid being blocked by sites.
	req.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7")

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d for %s", resp.StatusCode, url)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBodySize))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	parsedURL, _ := nurl.Parse(url)
	article, err := readability.FromReader(strings.NewReader(string(body)), parsedURL)
	if err != nil {
		return nil, fmt.Errorf("readability: %w", err)
	}

	text := normalizeText(article.TextContent)

	// Content quality validation: reject suspiciously short content.
	if utf8.RuneCountInString(text) < minTextLength {
		return nil, fmt.Errorf("extracted content too short (%d chars), possibly blocked or empty page", utf8.RuneCountInString(text))
	}

	if utf8.RuneCountInString(text) > maxTextLength {
		runes := []rune(text)
		text = string(runes[:maxTextLength]) + "\n... [truncated]"
	}

	wordCount := len(strings.Fields(text))

	// Extract publish date from go-readability's Article.PublishedTime if available.
	var publishDate string
	if article.PublishedTime != nil && !article.PublishedTime.IsZero() {
		publishDate = article.PublishedTime.Format(time.RFC3339)
	}

	return &ExtractedContent{
		NormalizedText: text,
		Meta: ContentMeta{
			Author:      article.Byline,
			PublishDate: publishDate,
			WordCount:   wordCount,
		},
	}, nil
}

var multiSpace = regexp.MustCompile(`[ \t]+`)
var multiNewline = regexp.MustCompile(`\n{3,}`)

func normalizeText(s string) string {
	s = strings.TrimSpace(s)
	s = multiSpace.ReplaceAllString(s, " ")
	s = multiNewline.ReplaceAllString(s, "\n\n")
	return s
}
