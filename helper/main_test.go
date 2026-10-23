package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

type fakeCLI struct {
	calls  [][]string
	output map[string]string
	fail   map[string]error
}

func (f *fakeCLI) run(args ...string) (string, error) {
	f.calls = append(f.calls, args)
	key := strings.Join(args, " ")
	if err := f.fail[key]; err != nil {
		return "", err
	}
	return f.output[key], nil
}

func (f *fakeCLI) status() (tunnelStatus, error) {
	return parseStatusText(f.output["status"]), nil
}

func call(t *testing.T, cli mullvadCLI, req string) response {
	t.Helper()
	resp := handle([]byte(req), cli)
	// Round-trip through JSON, as the browser sees it.
	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatal(err)
	}
	var decoded response
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

func TestFraming(t *testing.T) {
	var buf bytes.Buffer
	if err := writeMessage(&buf, map[string]string{"cmd": "status"}); err != nil {
		t.Fatal(err)
	}
	if got := binary.LittleEndian.Uint32(buf.Bytes()[:4]); got != uint32(buf.Len()-4) {
		t.Fatalf("length prefix %d, body %d", got, buf.Len()-4)
	}
	raw, err := readMessage(&buf)
	if err != nil || string(raw) != `{"cmd":"status"}` {
		t.Fatalf("readMessage = %q, %v", raw, err)
	}

	var huge bytes.Buffer
	_ = binary.Write(&huge, binary.LittleEndian, uint32(maxRequestBytes+1))
	if _, err := readMessage(&huge); err == nil {
		t.Fatal("oversized message accepted")
	}
}

func TestCommandsMapToFixedCLICalls(t *testing.T) {
	cli := &fakeCLI{output: map[string]string{"version": "2025.9\n"}}
	for _, req := range []string{
		`{"cmd":"connect"}`,
		`{"cmd":"disconnect"}`,
		`{"cmd":"reconnect"}`,
		`{"cmd":"setLocation","country":"se"}`,
		`{"cmd":"setLocation","country":"se","city":"got"}`,
	} {
		if resp := call(t, cli, req); resp["ok"] != true {
			t.Fatalf("%s: %v", req, resp)
		}
	}
	want := [][]string{
		{"connect"},
		{"disconnect"},
		{"reconnect"},
		{"relay", "set", "location", "se"},
		{"relay", "set", "location", "se", "got"},
	}
	if !reflect.DeepEqual(cli.calls, want) {
		t.Fatalf("calls = %v", cli.calls)
	}

	hello := call(t, cli, `{"cmd":"hello"}`)
	if hello["helper"] != version || hello["mullvad"] != "2025.9" {
		t.Fatalf("hello = %v", hello)
	}
}

func TestRejectsUnknownCommandsAndBadArguments(t *testing.T) {
	cli := &fakeCLI{}
	for _, req := range []string{
		`{"cmd":"rm -rf /"}`,
		`{"cmd":"setLocation","country":"se; reboot"}`,
		`{"cmd":"setLocation","country":"SE"}`,
		`{"cmd":"setLocation","country":"se","city":"--help"}`,
		`not json`,
	} {
		if resp := call(t, cli, req); resp["ok"] != false {
			t.Fatalf("%s accepted: %v", req, resp)
		}
	}
	if len(cli.calls) != 0 {
		t.Fatalf("CLI ran for rejected requests: %v", cli.calls)
	}
}

func TestCLIErrorsAreReported(t *testing.T) {
	cli := &fakeCLI{fail: map[string]error{"connect": errors.New("mullvad connect: account expired")}}
	resp := call(t, cli, `{"cmd":"connect"}`)
	if resp["ok"] != false || resp["error"] != "mullvad connect: account expired" {
		t.Fatalf("resp = %v", resp)
	}
}

func TestParseStatusText(t *testing.T) {
	cases := map[string]tunnelStatus{
		"Connected\n    Relay:                  se-got-wg-001\n    Features:               Quantum Resistance\n    Visible location:       Sweden, Gothenburg. IPv4: 185.213.154.68\n": {
			State: "connected", Relay: "se-got-wg-001", Location: "Sweden, Gothenburg",
		},
		"Tunnel status: Connected to WireGuard se-got-wg-001 (185.213.154.68:51820/UDP) in Gothenburg, Sweden\n": {
			State: "connected", Relay: "se-got-wg-001", Location: "Gothenburg, Sweden",
		},
		"Disconnected\n":                   {State: "disconnected"},
		"Connecting to de-fra-wg-005...\n": {State: "connecting", Relay: "de-fra-wg-005"},
		"Blocked: The device is offline\n": {State: "blocked"},
		"Tunnel status: Disconnected\n":    {State: "disconnected"},
		"Something new\n":                  {State: "unknown"},
	}
	for input, want := range cases {
		if got := parseStatusText(input); got != want {
			t.Errorf("parseStatusText(%q) = %+v, want %+v", input, got, want)
		}
	}
}

func TestParseStatusJSON(t *testing.T) {
	out := `{"state":"connected","details":{"location":{"country":"Sweden","city":"Gothenburg","hostname":"se-got-wg-001"}}}`
	got, ok := parseStatusJSON(out)
	want := tunnelStatus{State: "connected", Relay: "se-got-wg-001", Location: "Sweden, Gothenburg"}
	if !ok || got != want {
		t.Fatalf("parseStatusJSON = %+v, %v", got, ok)
	}
	if _, ok := parseStatusJSON("Connected"); ok {
		t.Fatal("text accepted as JSON")
	}
}

func TestStatusIncludesRawOutput(t *testing.T) {
	cli := &fakeCLI{output: map[string]string{"status": "Disconnected\n"}}
	resp := call(t, cli, `{"cmd":"status"}`)
	if resp["state"] != "disconnected" {
		t.Fatalf("resp = %v", resp)
	}
	if got := truncate(strings.Repeat("x", 600), maxRawBytes); len(got) != maxRawBytes+3 {
		t.Fatalf("truncate kept %d bytes", len(got))
	}
}

func TestParseCountries(t *testing.T) {
	out := "Albania (al)\n\tTirana (tia) @ 41.32795°N, 19.81902°W\n\t\tal-tia-wg-001 (31.171.153.66, 2a04:27c0:0:3::f001) - WireGuard\nSweden (se)\r\n\tGothenburg (got) @ 57.70887°N\n"
	want := []country{{Code: "al", Name: "Albania"}, {Code: "se", Name: "Sweden"}}
	if got := parseCountries(out); !reflect.DeepEqual(got, want) {
		t.Fatalf("parseCountries = %v", got)
	}
}
