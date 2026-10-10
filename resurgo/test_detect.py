import json

from resurgo.project import detect_type, dummy_env, needs_secret
from resurgo.run import detect_pm


def test_detect_pm():
    assert detect_pm(["package.json", "pnpm-lock.yaml"]) == "pnpm"
    assert detect_pm(["yarn.lock"]) == "yarn"
    assert detect_pm(["package-lock.json"]) == "npm"
    assert detect_pm(["package.json"]) is None


def pkg(**kw):
    return {"package.json": json.dumps(kw)}


def test_detect_type():
    assert detect_type({"foundry.toml": "", **pkg(name="x")})[0] == "foundry"
    assert detect_type({"Cargo.toml": "[workspace]\n"})[0] == "rust"
    assert detect_type(pkg(devDependencies={"electron": "1"}))[0] == "desktop"
    member = {"apps/a/package.json": '{"dependencies": {"electron": "1"}}'}
    assert detect_type(pkg(name="m"), member)[0] == "desktop"
    assert detect_type({**pkg(name="m"), "pnpm-workspace.yaml": ""})[0] == "monorepo"
    assert detect_type(pkg(workspaces=["a"]))[0] == "monorepo"
    assert detect_type(pkg(scripts={"dev": "vite"}))[0] == "web_app"
    assert detect_type(pkg(dependencies={"express": "4"}))[0] == "web_app"
    assert detect_type(pkg(name="lib", scripts={"build": "tsc"}))[0] == "node_lib"
    assert detect_type({})[0] == "unsupported"
    env = dummy_env("API_KEY=\nSITE_URL=your-url\nPORT=8080 # port\n")
    assert env == "API_KEY=dummy-secret-value\nSITE_URL=http://localhost:3000\nPORT=8080\n"
    assert needs_secret("Error: API_KEY is not set", "API_KEY=\nPORT=1\n") == "API_KEY"


if __name__ == "__main__":
    test_detect_pm()
    test_detect_type()
    print("ok")
