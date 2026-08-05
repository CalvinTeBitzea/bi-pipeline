"""
WHAT THIS FILE IS, IN BUSINESS TERMS
--------------------------------------
Every other test in this folder checks that the code is CORRECT. This one
checks something different and easy to forget: that the files the code needs
in order to work actually get SHIPPED to the server it runs on.

Those are not the same question, and the gap between them hid a real bug for
a long time. `.vercelignore` excluded `*.md`, which quietly took
`pbi-skills/<skill>/SKILL.md` with it. The visual templates still deployed —
only the one file that makes them findable didn't. So in production the skill
registry loaded EMPTY, `resolve_skill()` returned None for every visual, and
every chart that was supposed to render from a polished hand-authored
template silently came out as a plain generic one instead. Silently, because
the builder only warns when a skill FAILS to fill, not when it was never
found in the first place.

Nothing caught it: local runs and the CLI read straight from the working
directory, where SKILL.md is obviously present. The whole test suite passed
the entire time. The only place the bug existed was the deployed copy.

So this test builds the deployed file set — applying `.vercelignore` the same
way Vercel does — and then asks the real registry loader what it can find in
it. If a future change to `.vercelignore` (or to how skills are laid out on
disk) breaks packaging again, this fails immediately instead of quietly
downgrading everyone's reports.
"""
import fnmatch
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from lib import skills  # noqa: E402

BUILDER_ROOT = Path(__file__).parent.parent
VERCELIGNORE = BUILDER_ROOT / ".vercelignore"

# Directories that never exist in a deployment for reasons unrelated to
# .vercelignore, so copying them would just be slow and pointless.
ALWAYS_SKIP = {".git", "__pycache__", "node_modules", ".pytest_cache"}


def _ignore_patterns() -> list[str]:
    if not VERCELIGNORE.is_file():
        return []
    return [ln.strip() for ln in VERCELIGNORE.read_text().splitlines()
            if ln.strip() and not ln.strip().startswith("#")]


def _is_ignored(rel: Path, patterns: list[str]) -> bool:
    """Apply .vercelignore's gitignore-style matching to one relative path.

    Three shapes matter here: a trailing slash means "this directory at any
    depth", a pattern containing a slash is matched against the whole path,
    and a bare pattern is matched against the file name alone at any depth —
    which is exactly why `*.md` reached a nested SKILL.md.
    """
    for pat in patterns:
        if pat.endswith("/"):
            if pat.rstrip("/") in rel.parts:
                return True
        elif "/" in pat:
            if fnmatch.fnmatch(str(rel), pat):
                return True
        elif fnmatch.fnmatch(rel.name, pat):
            return True
    return False


@pytest.fixture(scope="module")
def deployed_tree(tmp_path_factory) -> Path:
    """A copy of builder/ containing only what actually reaches production."""
    dest = tmp_path_factory.mktemp("deployed")
    patterns = _ignore_patterns()
    for f in BUILDER_ROOT.rglob("*"):
        if not f.is_file():
            continue
        rel = f.relative_to(BUILDER_ROOT)
        if ALWAYS_SKIP & set(rel.parts):
            continue
        if _is_ignored(rel, patterns):
            continue
        (dest / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, dest / rel)
    return dest


def test_skills_are_loadable_from_the_deployed_file_set(deployed_tree):
    """The regression guard. Every skill that exists in the working tree must
    still be findable in the deployed copy — not just its template files, the
    whole skill, resolvable by name through the real registry loader."""
    local = skills.load_skills(BUILDER_ROOT / "pbi-skills")
    deployed = skills.load_skills(deployed_tree / "pbi-skills")

    assert local, "no skills on disk at all — this test can't prove anything"
    missing = sorted(set(local) - set(deployed))
    assert not missing, (
        f"skill(s) {missing} exist locally but cannot be loaded from the deployed "
        f"file set — check .vercelignore. In production this does not raise: "
        f"resolve_skill() just returns None and every visual naming the skill "
        f"silently falls back to a plain generic chart."
    )


def test_each_deployed_skill_can_still_be_filled(deployed_tree):
    """A skill is only useful if its TEMPLATE files shipped too. Loading it
    proves SKILL.md survived; filling it proves the rest did."""
    for name, skill in skills.load_skills(deployed_tree / "pbi-skills").items():
        filled = skills.fill(skill, skill.example_tokens())
        assert any(rel.endswith(".visual.json") for rel in filled), (
            f"skill '{name}' deployed without any .visual.json template — it "
            f"would load but produce no visual"
        )
