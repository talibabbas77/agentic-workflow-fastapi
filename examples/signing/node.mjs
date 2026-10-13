// npm install jose
import { randomUUID } from "node:crypto";
import { importPKCS8, SignJWT } from "jose";

const privateKey = await importPKCS8(process.env.DOCENT_PRIVATE_KEY, "ES256");

export function docentToken(user) {
  return new SignJWT({ name: user.name, email: user.email, ctx: { plan: user.plan } })
    .setProtectedHeader({ alg: "ES256", kid: process.env.DOCENT_KEY_ID })
    .setIssuer(process.env.DOCENT_WIDGET_ID)
    .setAudience("docent")
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime("5m")
    .setJti(randomUUID())
    .sign(privateKey);
}

// Express, behind your login check:
// app.get("/docent-token", requireLogin, async (req, res) =>
//   res.type("text").send(await docentToken(req.user)));

if (import.meta.main) {
  const user = { id: "user-123", name: "Ana Souza", email: "ana@example.com", plan: "Team" };
  console.log(await docentToken(user));
}
