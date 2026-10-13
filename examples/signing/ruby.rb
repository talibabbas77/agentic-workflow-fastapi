# gem install jwt
require "jwt"
require "openssl"
require "securerandom"

PRIVATE_KEY = OpenSSL::PKey::EC.new(ENV.fetch("DOCENT_PRIVATE_KEY"))

def docent_token(user)
  now = Time.now.to_i
  claims = {
    iss: ENV.fetch("DOCENT_WIDGET_ID"),
    aud: "docent",
    sub: user[:id].to_s,
    iat: now,
    exp: now + 300,
    jti: SecureRandom.uuid,
    name: user[:name],
    email: user[:email],
    ctx: { plan: user[:plan] }
  }
  JWT.encode(claims, PRIVATE_KEY, "ES256", { kid: ENV.fetch("DOCENT_KEY_ID") })
end

# Rails, in a controller behind your login check:
#   def docent_token_endpoint
#     render plain: docent_token(current_user.slice(:id, :name, :email, :plan))
#   end

if $PROGRAM_NAME == __FILE__
  puts docent_token(id: "user-123", name: "Ana Souza", email: "ana@example.com", plan: "Team")
end
