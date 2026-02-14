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

const maxTextLength = 15000

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

// Extract fetches the URL and extracts the main content.
func (e *HTTPExtractor) Extract(ctx context.Context, url string) (*ExtractedContent, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; ReadDo/0.1)")

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d for %s", resp.StatusCode, url)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 5*1024*1024)) // 5MB limit
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	parsedURL, _ := nurl.Parse(url)
	article, err := readability.FromReader(strings.NewReader(string(body)), parsedURL)
	if err != nil {
		return nil, fmt.Errorf("readability: %w", err)
	}

	text := normalizeText(article.TextContent)
	if utf8.RuneCountInString(text) > maxTextLength {
		runes := []rune(text)
		text = string(runes[:maxTextLength]) + "\n... [truncated]"
	}

	wordCount := len(strings.Fields(text))

	return &ExtractedContent{
		NormalizedText: text,
		Meta: ContentMeta{
			Author:      article.Byline,
			PublishDate: "",
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
