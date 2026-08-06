#! /usr/bin/env node
/**
 * Print the gateway password held by a Delta Dore account, for a given MAC.
 *
 * The same lookup the plugin performs at startup, runnable on its own so a
 * misconfiguration can be diagnosed without waiting on Homebridge:
 *
 *   pnpm resolve-credentials <email> <password> <mac>
 *   pnpm resolve-credentials --email … --password … --mac 001A25123456
 *
 * Note that the MAC is required: Delta Dore's site API validates a gateway you
 * name, it does not enumerate the gateways an account owns.
 */
import { normalizeMacAddress, resolveGatewayPassword } from "../src/util/deltadore.js";

const args = process.argv.slice(2);

const flag = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
};

const positional = args.filter((arg, index) => {
  if (arg.startsWith("--")) return false;
  return !(index > 0 && args[index - 1]?.startsWith("--"));
});

const main = async () => {
  const email = flag("email") ?? positional[0] ?? process.env["HOMEBRIDGE_TYDOM_EMAIL"];
  const password = flag("password") ?? positional[1];
  const mac = flag("mac") ?? positional[2];

  if (!email || !password || !mac) {
    console.error("Usage: resolve-credentials <email> <password> <mac>");
    console.error("   or: resolve-credentials --email … --password … --mac …");
    process.exit(1);
  }

  const gatewayPassword = await resolveGatewayPassword({ email, password, mac });
  console.dir({
    hostname: "mediation.tydom.com",
    username: normalizeMacAddress(mac),
    password: gatewayPassword,
  });
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
  process.exit(1);
});
