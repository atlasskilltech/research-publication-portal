/**
 * Set (or reset) a user's password via the Supabase Auth Admin API.
 *
 * This is the no-SMTP way to give the provisioned administrators a real
 * password. It works for any existing account, not just admins.
 *
 * Usage (secure — password typed at a hidden prompt, never in argv/history):
 *   npm run supabase:set-admin-password -- "<email>"
 *     → prompts: "New password (hidden): "  then  "Confirm password: "
 *
 * You may still pass the password as a second argument for scripting, but then
 * it lands in your shell history and process list — the hidden prompt is safer.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY (server-only).
 */
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";

/** Read a line from stdin without echoing the characters. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (str) => {
      if (!muted || /[\r\n]/.test(str)) rl.output.write(str);
    };
    rl.question(question, (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
    muted = true;
  });
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`\n✖ Missing required environment variable ${name}.\n`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const [email, passwordArg] = process.argv.slice(2);
  if (!email) {
    console.error('\nUsage: npm run supabase:set-admin-password -- "<email>"   (you will be prompted for the password)\n');
    process.exit(1);
  }

  let password = passwordArg;
  if (!password) {
    password = await askHidden(`New password for ${email} (hidden): `);
    const confirm = await askHidden("Confirm password: ");
    if (password !== confirm) {
      console.error("\n✖ Passwords did not match.\n");
      process.exit(1);
    }
  }
  if (!password || password.length < 10) {
    console.error("\n✖ Choose a password of at least 10 characters.\n");
    process.exit(1);
  }

  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const secret = requireEnv("SUPABASE_SECRET_KEY");
  const admin = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Locate the user by email.
  let user = null;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    user = data.users.find((u) => (u.email || "").toLowerCase() === email.toLowerCase());
    if (user || data.users.length < 200) break;
  }
  if (!user) {
    console.error(`\n✖ No account found for ${email}. Provision it first.\n`);
    process.exit(1);
  }

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password,
    email_confirm: true,
  });
  if (error) {
    console.error(`\n✖ Could not set password for ${email}: ${error.message}\n`);
    process.exit(1);
  }

  console.log(`\n✓ Password updated for ${email}. They can sign in now.\n`);
}

main().catch((e) => {
  console.error("\n✖ Failed:", e?.message || e);
  process.exit(1);
});
