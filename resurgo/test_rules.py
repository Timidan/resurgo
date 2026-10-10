from resurgo.rules import apply_rules, node_major, package_manager


def test_rules():
    # engines.node picks the highest LTS major that satisfies the range
    assert node_major({"package.json": '{"engines":{"node":"^20.19 || ^22"}}'})[0] == 22
    assert node_major({"package.json": '{"engines":{"node":">=18"}}'})[0] == 24
    assert node_major({".nvmrc": "v20.11.0\n"})[0] == 20
    # lockfile format picks the package manager when packageManager is absent
    assert package_manager({"pnpm-lock.yaml": "lockfileVersion: '6.0'\n"})[:2] == ("pnpm", "8.15.9")
    assert package_manager({"pnpm-lock.yaml": "lockfileVersion: '9.0'\n"})[:2] == ("pnpm", "9.15.9")
    assert package_manager({"pnpm-lock.yaml": "lockfileVersion: '10.0'\n"}) is None
    assert package_manager({"yarn.lock": "# yarn lockfile v1\n"})[:2] == ("yarn", "1.22.22")
    assert package_manager({"yarn.lock": "__metadata:\n  version: 8\n"})[:2] == ("yarn", "4.9.2")
    assert package_manager({"package-lock.json": '{"lockfileVersion": 1}'})[:2] == ("npm", "6.14.18")
    # rules become file fixes; an existing .nvmrc that already matches is left alone
    fired, fixes = apply_rules({"package.json": '{"engines":{"node":"20.x"}}\n',
                                "pnpm-lock.yaml": "lockfileVersion: '6.0'\n"})
    assert [r["rule"] for r in fired] == ["node-major", "package-manager"]
    assert fixes[".nvmrc"] == "20\n" and '"pnpm@8.15.9"' in fixes["package.json"]
    assert apply_rules({".nvmrc": "20\n"}) == ([], {})


def test_native_module_rule():
    out = "npm error gyp ERR! build error\nnpm error gyp ERR! not ok\n"
    pkg = {"package.json": '{"name": "x"}'}
    fired, fixes = apply_rules(pkg, out)
    assert [r["rule"] for r in fired] == ["native-module"] and fixes[".nvmrc"] == "22\n"
    assert apply_rules({"package.json": '{"engines": {"node": "^24"}}'}, out)[1] == {}
    assert apply_rules({**pkg, ".nvmrc": "24\n"}, out)[1] == {}
    assert apply_rules(pkg, "npm error code ERESOLVE")[1] == {}


if __name__ == "__main__":
    test_rules()
    test_native_module_rule()
    print("ok")
