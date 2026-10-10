from resurgo.run import detect_pm


def test_detect_pm():
    assert detect_pm(["package.json", "pnpm-lock.yaml"]) == "pnpm"
    assert detect_pm(["yarn.lock"]) == "yarn"
    assert detect_pm(["package-lock.json"]) == "npm"
    assert detect_pm(["package.json"]) is None


if __name__ == "__main__":
    test_detect_pm()
    print("ok")
