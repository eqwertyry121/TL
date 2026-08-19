import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const requiredVersion = readRequiredGoVersion();
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage: node scripts/go-toolchain.mjs <go args...>");
  process.exit(2);
}

const go = resolveGoExecutable(requiredVersion);
const result = spawnSync(go, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);

function readRequiredGoVersion() {
  const mod = readFileSync("go.mod", "utf8");
  const match = mod.match(/^go\s+(\d+\.\d+\.\d+)/m);
  if (!match) {
    console.error("Cannot find required Go version in go.mod");
    process.exit(1);
  }
  return match[1];
}

function resolveGoExecutable(required) {
  const explicit = process.env.GO_EXE || process.env.GO_TOOLCHAIN_EXE;
  if (explicit) {
    if (!existsSync(explicit)) {
      console.error(`Configured Go executable does not exist: ${explicit}`);
      process.exit(1);
    }
    return explicit;
  }

  const systemVersion = goVersion("go");
  if (systemVersion && compareVersions(systemVersion, required) >= 0) {
    return "go";
  }

  for (const candidate of downloadedToolchainCandidates(required)) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  console.error([
    `Go ${required} is required by go.mod, but system Go is ${systemVersion || "not available"}.`,
    "Install the required Go version or set GO_EXE to the full path of a compatible go executable.",
  ].join("\n"));
  process.exit(1);
}

function goVersion(executable) {
  const result = spawnSync(executable, ["version"], {
    cwd: process.cwd(),
    env: { ...process.env, GOTOOLCHAIN: "local" },
    shell: false,
    encoding: "utf8",
  });
  if (result.status !== 0) return "";
  const match = result.stdout.match(/go version go(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1] || "";
}

function downloadedToolchainCandidates(required) {
  const goos = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  }[process.platform];
  const goarch = {
    arm64: "arm64",
    x64: "amd64",
  }[process.arch];
  if (!goos || !goarch) return [];

  const exe = process.platform === "win32" ? "go.exe" : "go";
  const candidates = [
    path.join(homedir(), "sdk", `go${required}`, "bin", exe),
  ];
  const gopaths = new Set([
    process.env.GOPATH,
    path.join(homedir(), "go"),
  ].filter(Boolean));

  for (const gopath of gopaths) {
    candidates.push(path.join(
      gopath,
      "pkg",
      "mod",
      "golang.org",
      `toolchain@v0.0.1-go${required}.${goos}-${goarch}`,
      "bin",
      exe,
    ));
  }
  return candidates;
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
