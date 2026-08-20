package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestVerifyTelegramInitData(t *testing.T) {
	token := "123456:test-token"
	now := time.Unix(1_700_000_000, 0)
	values := url.Values{}
	values.Set("auth_date", "1700000000")
	values.Set("query_id", "aa")
	values.Set("user", `{"id":1048084234,"first_name":"Owner","username":"owner","language_code":"ru"}`)
	values.Set("hash", sign(values, token))

	user, err := VerifyTelegramInitData(values.Encode(), token, time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	if user.ID != 1048084234 {
		t.Fatalf("user id=%d", user.ID)
	}

	values.Set("user", `{"id":1}`)
	if _, err := VerifyTelegramInitData(values.Encode(), token, time.Hour, now); err == nil {
		t.Fatal("forged data must fail")
	}
}

func TestVerifyTelegramInitDataRejectsFutureAuthDate(t *testing.T) {
	token := "123456:test-token"
	now := time.Unix(1_700_000_000, 0)
	values := url.Values{}
	values.Set("auth_date", "1700000360")
	values.Set("query_id", "future")
	values.Set("user", `{"id":1048084234,"first_name":"Owner"}`)
	values.Set("hash", sign(values, token))

	if _, err := VerifyTelegramInitData(values.Encode(), token, time.Hour, now); err == nil {
		t.Fatal("initData from the future must fail")
	}
}

func sign(values url.Values, token string) string {
	clone := url.Values{}
	for k, v := range values {
		clone[k] = v
	}
	clone.Del("hash")
	keys := make([]string, 0, len(clone))
	for key := range clone {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+clone.Get(key))
	}
	secretHMAC := hmac.New(sha256.New, []byte("WebAppData"))
	_, _ = secretHMAC.Write([]byte(token))
	secret := secretHMAC.Sum(nil)
	dataHMAC := hmac.New(sha256.New, secret)
	_, _ = dataHMAC.Write([]byte(strings.Join(parts, "\n")))
	return hex.EncodeToString(dataHMAC.Sum(nil))
}
