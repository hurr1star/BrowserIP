// browserip-helper is the native messaging host for the BrowserIP extension.
// It lets the extension drive the Mullvad VPN app through Mullvad's own
// command-line tool, and nothing else: every request maps to one fixed
// command, and arguments are validated before they reach the CLI.
//
// Protocol (native messaging): each message is a 32-bit little-endian length
// followed by that many bytes of JSON, on stdin (requests) and stdout
// (responses).
package main

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"regexp"
)

const version = "1.0.0"

// Browsers cap messages from the extension at 4 GB; ours are tiny, so refuse
// anything that isn't.
const maxRequestBytes = 64 * 1024

type request struct {
	Cmd     string `json:"cmd"`
	Country string `json:"country,omitempty"`
	City    string `json:"city,omitempty"`
}

type response map[string]any

var (
	countryCode = regexp.MustCompile(`^[a-z]{2}$`)
	cityCode    = regexp.MustCompile(`^[a-z]{3}$`)
)

func readMessage(r io.Reader) ([]byte, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	if length > maxRequestBytes {
		return nil, fmt.Errorf("message of %d bytes is too large", length)
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func writeMessage(w io.Writer, msg any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(data))); err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

func failure(err error) response {
	return response{"ok": false, "error": err.Error()}
}

func handle(raw []byte, cli mullvadCLI) response {
	var req request
	if err := json.Unmarshal(raw, &req); err != nil {
		return failure(fmt.Errorf("invalid request: %w", err))
	}

	switch req.Cmd {
	case "hello":
		resp := response{"ok": true, "helper": version}
		if v, err := cli.run("version"); err == nil {
			resp["mullvad"] = firstLine(v)
		} else {
			resp["mullvadError"] = err.Error()
		}
		return resp
	case "status":
		status, err := cli.status()
		if err != nil {
			return failure(err)
		}
		return response{
			"ok":       true,
			"state":    status.State,
			"relay":    status.Relay,
			"location": status.Location,
			"raw":      status.Raw,
		}
	case "connect", "disconnect", "reconnect":
		if _, err := cli.run(req.Cmd); err != nil {
			return failure(err)
		}
		return response{"ok": true}
	case "setLocation":
		if !countryCode.MatchString(req.Country) {
			return failure(errors.New("country must be a two-letter code"))
		}
		args := []string{"relay", "set", "location", req.Country}
		if req.City != "" {
			if !cityCode.MatchString(req.City) {
				return failure(errors.New("city must be a three-letter code"))
			}
			args = append(args, req.City)
		}
		if _, err := cli.run(args...); err != nil {
			return failure(err)
		}
		return response{"ok": true}
	case "countries":
		out, err := cli.run("relay", "list")
		if err != nil {
			return failure(err)
		}
		return response{"ok": true, "countries": parseCountries(out)}
	default:
		return failure(fmt.Errorf("unknown command %q", req.Cmd))
	}
}

func main() {
	cli := newMullvadCLI()
	for {
		raw, err := readMessage(os.Stdin)
		if errors.Is(err, io.EOF) {
			return
		}
		if err != nil {
			_ = writeMessage(os.Stdout, failure(err))
			return
		}
		if err := writeMessage(os.Stdout, handle(raw, cli)); err != nil {
			return
		}
	}
}
