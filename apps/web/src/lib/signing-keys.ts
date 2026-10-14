/**
 * ES256 signing keys in the browser with WebCrypto. Only the public half ever
 * leaves the page; the private half is exported once, for the person to download.
 */

const ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;

export type PublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };

/** The four members Docent accepts. Anything else in an exported JWK, such as `d`, is dropped. */
function publicPart(jwk: JsonWebKey): PublicJwk {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) {
    throw new Error("Docent needs an EC P-256 public key (ES256).");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export async function generateSigningKey() {
  const pair = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
  const publicJwk = publicPart(await crypto.subtle.exportKey("jwk", pair.publicKey));
  return { publicJwk, privateKey: pair.privateKey };
}

function armor(label: string, der: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(der)) binary += String.fromCharCode(byte);
  const lines = btoa(binary).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** PKCS8 PEM, the format the signing examples on the docs page read. */
export async function privateKeyPem(privateKey: CryptoKey) {
  return armor("PRIVATE KEY", await crypto.subtle.exportKey("pkcs8", privateKey));
}

/**
 * Turn a pasted SPKI PEM (what `openssl pkey -pubout` writes) into a public JWK.
 * Refuses private keys outright, and anything that is not P-256.
 */
export async function publicJwkFromPem(pem: string): Promise<PublicJwk> {
  const text = pem.trim();
  if (/PRIVATE KEY/.test(text)) {
    throw new Error("This is a private key. Keep it on your server and paste the public key instead.");
  }
  const match = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/.exec(text);
  if (!match) {
    throw new Error("Paste the whole public key, from -----BEGIN PUBLIC KEY----- to -----END PUBLIC KEY-----.");
  }
  let der: Uint8Array<ArrayBuffer>;
  try {
    der = Uint8Array.from(atob(match[1]!.replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  } catch {
    throw new Error("This key is damaged. Copy it again from the file.");
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("spki", der, ALGORITHM, true, ["verify"]);
  } catch {
    throw new Error("This is not an EC P-256 key. Docent signs with ES256, so create the key with the commands in the install guide.");
  }
  return publicPart(await crypto.subtle.exportKey("jwk", key));
}

/** Offer text as a file download without keeping it anywhere. */
export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/x-pem-file" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Let the download start before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
