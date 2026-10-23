package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"time"
)

const commandTimeout = 30 * time.Second

type mullvadCLI interface {
	run(args ...string) (string, error)
	status() (tunnelStatus, error)
}

type execCLI struct {
	path string
}

type tunnelStatus struct {
	State    string `json:"state"`
	Relay    string `json:"relay,omitempty"`
	Location string `json:"location,omitempty"`
}

// Browsers start native hosts with a minimal PATH (on macOS it lacks
// /usr/local/bin), so look in the places Mullvad installs its CLI as well.
func candidatePaths() []string {
	switch runtime.GOOS {
	case "windows":
		return []string{
			os.ExpandEnv(`${ProgramFiles}\Mullvad VPN\resources\mullvad.exe`),
			`C:\Program Files\Mullvad VPN\resources\mullvad.exe`,
		}
	case "darwin":
		return []string{"/usr/local/bin/mullvad", "/Applications/Mullvad VPN.app/Contents/Resources/mullvad"}
	default:
		return []string{"/usr/bin/mullvad", "/usr/local/bin/mullvad", "/opt/Mullvad VPN/resources/mullvad"}
	}
}

func findCLI() string {
	if path := os.Getenv("BROWSERIP_MULLVAD_CLI"); path != "" {
		return path
	}
	if path, err := exec.LookPath("mullvad"); err == nil {
		return path
	}
	for _, path := range candidatePaths() {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

func newMullvadCLI() mullvadCLI {
	return execCLI{path: findCLI()}
}

func (c execCLI) run(args ...string) (string, error) {
	if c.path == "" {
		return "", errors.New("the Mullvad command-line tool was not found; is the Mullvad app installed?")
	}
	ctx, cancel := context.WithTimeout(context.Background(), commandTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.path, args...)
	hideWindow(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = strings.TrimSpace(stdout.String())
		}
		if message == "" {
			message = err.Error()
		}
		return "", fmt.Errorf("mullvad %s: %s", strings.Join(args, " "), firstLine(message))
	}
	return stdout.String(), nil
}

func (c execCLI) status() (tunnelStatus, error) {
	// Recent CLIs can print JSON; older ones only text.
	if out, err := c.run("status", "--json"); err == nil {
		if status, ok := parseStatusJSON(out); ok {
			return status, nil
		}
	}
	out, err := c.run("status")
	if err != nil {
		return tunnelStatus{}, err
	}
	return parseStatusText(out), nil
}

var (
	stateWord    = regexp.MustCompile(`(?i)^(?:tunnel status:\s*)?(connected|connecting|disconnected|disconnecting|blocked|error)\b`)
	relayName    = regexp.MustCompile(`\b[a-z]{2}-[a-z]{3}-(?:wg|ovpn|br)-\d{3}(?:-[a-z0-9]+)?\b`)
	visibleLine  = regexp.MustCompile(`(?m)^\s*Visible location:\s*([^.\n]+)`)
	legacyPlace  = regexp.MustCompile(`(?m)\bin ([^\n()]+?)\s*$`)
	countryEntry = regexp.MustCompile(`^(\S.*?) \(([a-z]{2})\)\s*$`)
)

// parseStatusText reads `mullvad status` output, in both the current layout
//
//	Connected
//	    Relay:                  se-got-wg-001
//	    Visible location:       Sweden, Gothenburg. IPv4: 185.213.154.68
//
// and the older one-line "Tunnel status: Connected to ... in Gothenburg, Sweden".
func parseStatusText(out string) tunnelStatus {
	text := strings.TrimSpace(out)
	status := tunnelStatus{State: "unknown"}
	if match := stateWord.FindStringSubmatch(text); match != nil {
		status.State = strings.ToLower(match[1])
		if status.State == "error" {
			status.State = "blocked"
		}
	}
	status.Relay = relayName.FindString(text)
	if match := visibleLine.FindStringSubmatch(text); match != nil {
		status.Location = strings.TrimSpace(match[1])
	} else if status.State == "connected" {
		if match := legacyPlace.FindStringSubmatch(firstLine(text)); match != nil {
			status.Location = strings.TrimSpace(match[1])
		}
	}
	return status
}

// parseStatusJSON accepts `mullvad status --json` output. Its exact shape has
// changed between releases, so it only relies on a "state" string and looks
// for hostname/country/city keys anywhere in the document.
func parseStatusJSON(out string) (tunnelStatus, bool) {
	var doc map[string]any
	if err := json.Unmarshal([]byte(out), &doc); err != nil {
		return tunnelStatus{}, false
	}
	state, ok := doc["state"].(string)
	if !ok {
		return tunnelStatus{}, false
	}
	status := tunnelStatus{State: strings.ToLower(state)}
	if status.State == "error" {
		status.State = "blocked"
	}
	status.Relay = findString(doc, "hostname")
	place := []string{}
	for _, key := range []string{"country", "city"} {
		if value := findString(doc, key); value != "" {
			place = append(place, value)
		}
	}
	status.Location = strings.Join(place, ", ")
	return status, true
}

func findString(value any, key string) string {
	switch v := value.(type) {
	case map[string]any:
		if s, ok := v[key].(string); ok && s != "" {
			return s
		}
		for _, child := range v {
			if s := findString(child, key); s != "" {
				return s
			}
		}
	case []any:
		for _, child := range v {
			if s := findString(child, key); s != "" {
				return s
			}
		}
	}
	return ""
}

type country struct {
	Code string `json:"code"`
	Name string `json:"name"`
}

// parseCountries reads the unindented "Sweden (se)" lines of `mullvad relay list`.
func parseCountries(out string) []country {
	countries := []country{}
	for _, line := range strings.Split(out, "\n") {
		if match := countryEntry.FindStringSubmatch(strings.TrimRight(line, "\r")); match != nil {
			countries = append(countries, country{Code: match[2], Name: match[1]})
		}
	}
	return countries
}

func firstLine(text string) string {
	line, _, _ := strings.Cut(strings.TrimSpace(text), "\n")
	return strings.TrimSpace(line)
}
