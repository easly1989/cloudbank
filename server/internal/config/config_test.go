package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	t.Setenv("CB_ADDR", "")
	t.Setenv("CB_DATA_DIR", "")
	t.Setenv("CB_LOG_LEVEL", "")
	t.Setenv("CB_SECURE_COOKIES", "")

	c := Load()
	if c.Addr != ":8080" {
		t.Errorf("Addr = %q, want :8080", c.Addr)
	}
	if c.DataDir != "/data" {
		t.Errorf("DataDir = %q, want /data", c.DataDir)
	}
	if c.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", c.LogLevel)
	}
	if !c.SecureCookies {
		t.Errorf("SecureCookies = false, want true")
	}
}

func TestLoadOverrides(t *testing.T) {
	t.Setenv("CB_ADDR", "127.0.0.1:9000")
	t.Setenv("CB_DATA_DIR", "/tmp/cb")
	t.Setenv("CB_LOG_LEVEL", "debug")
	t.Setenv("CB_SECURE_COOKIES", "false")

	c := Load()
	if c.Addr != "127.0.0.1:9000" {
		t.Errorf("Addr = %q", c.Addr)
	}
	if c.DataDir != "/tmp/cb" {
		t.Errorf("DataDir = %q", c.DataDir)
	}
	if c.LogLevel != "debug" {
		t.Errorf("LogLevel = %q", c.LogLevel)
	}
	if c.SecureCookies {
		t.Errorf("SecureCookies = true, want false")
	}
}

func TestGetBoolEnvInvalidFallsBack(t *testing.T) {
	t.Setenv("CB_SECURE_COOKIES", "not-a-bool")
	if got := Load().SecureCookies; got != true {
		t.Errorf("SecureCookies = %v, want true (fallback)", got)
	}
}

func TestDemoLimits(t *testing.T) {
	t.Setenv("CB_DEMO_MAX_USERS", "")
	t.Setenv("CB_DEMO_PROXY_HOPS", "1")
	t.Setenv("CB_DEMO_MAX_WALLETS", "-2")
	t.Setenv("CB_DEMO_IDLE", "30m")

	d := Load().Demo
	if d.MaxUsers != 200 {
		t.Errorf("MaxUsers = %d, want the default 200", d.MaxUsers)
	}
	if d.ProxyHops != 1 {
		t.Errorf("ProxyHops = %d, want 1", d.ProxyHops)
	}
	if d.MaxWallets != 3 {
		t.Errorf("MaxWallets = %d, want the default 3 for a negative value", d.MaxWallets)
	}
	if d.Idle.Minutes() != 30 {
		t.Errorf("Idle = %v, want 30m", d.Idle)
	}
}
