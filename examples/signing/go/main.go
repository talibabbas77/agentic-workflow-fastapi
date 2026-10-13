// go get github.com/golang-jwt/jwt/v5
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type User struct{ ID, Name, Email, Plan string }

func DocentToken(user User) (string, error) {
	key, err := jwt.ParseECPrivateKeyFromPEM([]byte(os.Getenv("DOCENT_PRIVATE_KEY")))
	if err != nil {
		return "", err
	}
	jti := make([]byte, 16)
	if _, err := rand.Read(jti); err != nil {
		return "", err
	}
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, jwt.MapClaims{
		"iss":   os.Getenv("DOCENT_WIDGET_ID"),
		"aud":   "docent",
		"sub":   user.ID,
		"iat":   now.Unix(),
		"exp":   now.Add(5 * time.Minute).Unix(),
		"jti":   hex.EncodeToString(jti),
		"name":  user.Name,
		"email": user.Email,
		"ctx":   map[string]string{"plan": user.Plan},
	})
	token.Header["kid"] = os.Getenv("DOCENT_KEY_ID")
	return token.SignedString(key)
}

// net/http, behind your login check:
//   token, err := DocentToken(currentUser(r))
//   w.Header().Set("Content-Type", "text/plain")
//   w.Write([]byte(token))

func main() {
	user := User{ID: "user-123", Name: "Ana Souza", Email: "ana@example.com", Plan: "Team"}
	token, err := DocentToken(user)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(token)
}
