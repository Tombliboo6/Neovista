import pathlib
import unittest


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]


class WatchProdApiLogsScriptsTest(unittest.TestCase):
    def test_filtered_and_raw_watch_scripts_exist_with_expected_contract(self):
        filtered_script = REPO_ROOT / "scripts" / "watch-prod-api-logs.sh"
        raw_script = REPO_ROOT / "scripts" / "watch-prod-api-logs-raw.sh"
        command_launcher = REPO_ROOT / "scripts" / "watch-prod-api-logs.command"

        self.assertTrue(filtered_script.exists(), "filtered watcher script should exist")
        self.assertTrue(raw_script.exists(), "raw watcher script should exist")
        self.assertTrue(command_launcher.exists(), ".command launcher should exist")

        filtered_source = filtered_script.read_text(encoding="utf-8")
        raw_source = raw_script.read_text(encoding="utf-8")
        command_source = command_launcher.read_text(encoding="utf-8")

        for source in (filtered_source, raw_source):
            self.assertIn("43.154.202.242", source)
            self.assertIn("neovistassh.pem", source)
            self.assertIn("sudo journalctl -u neovista-api -f -n 150 -o short-iso", source)
            self.assertIn("ServerAliveInterval=30", source)
            self.assertIn("ServerAliveCountMax=3", source)
            self.assertIn("trap cleanup INT TERM", source)
            self.assertIn("--since", source)
            self.assertIn("printf '%q'", source)
            self.assertIn('journalctl_args+=("--since" "${SINCE_VALUE}")', source)
            self.assertIn('exec "${journalctl_args[@]}"', source)

        self.assertIn("POST /api/", filtered_source)
        self.assertIn("GET /api/", filtered_source)
        self.assertIn("Traceback", filtered_source)
        self.assertIn("ERROR", filtered_source)
        self.assertIn("Exception", filtered_source)
        self.assertIn("[Flash]", filtered_source)
        self.assertIn("[Pro Vision Prompt]", filtered_source)

        self.assertIn("watch-prod-api-logs.sh", command_source)
        self.assertIn("Terminal", command_source)


if __name__ == "__main__":
    unittest.main()
