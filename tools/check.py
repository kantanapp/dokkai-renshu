#!/usr/bin/env python3
"""問題データ (data/questions.json) を機械的に点検する。

使い方:
    pip install kanji-lists
    python3 tools/check.py

点検すること:
  1. 文章の字数(ふりがな・改行・空白を除く)
  2. 1セットの設問数が5問か
  3. focus(問いが指す箇所)と evidence(根拠の箇所)が、文章の中に実在するか
  4. 小学校で習わない漢字に、ふりがなが付いているか
     (文章でふりがなを付けた漢字は、設問・答え・解説では付けなくてよい)
  5. ふりがなの書き方 {漢字|よみ} がくずれていないか
"""
import json
import re
import sys
from pathlib import Path

from kanji_lists import KYOIKU

ELEMENTARY = KYOIKU.REIWA2  # 現行の学年別漢字配当表 1026字
RUBY = re.compile(r"\{([^{}|]+)\|([^{}|]+)\}")
KANJI = re.compile(r"[一-鿿々]")

# 字数の目安 (レベルid: (下限, 上限))
LENGTH = {1: (80, 120), 2: (80, 120), 3: (80, 120), 4: (80, 120), 5: (80, 120),
          6: (140, 210), 7: (290, 410)}


def plain(text):
    """ふりがなを取りのぞいた文字列"""
    return RUBY.sub(lambda m: m.group(1), text)


def unrubied(text):
    """ふりがなの付いた部分を消した文字列(= ふりがな無しで出ている部分)"""
    return RUBY.sub("", text)


def main():
    path = Path(__file__).resolve().parent.parent / "data" / "questions.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    errors, notes = [], []
    n_sets = n_q = 0

    for level in data["levels"]:
        lo, hi = LENGTH.get(level["id"], (0, 10 ** 6))
        for s in level["sets"]:
            n_sets += 1
            sid = s["id"]
            passage = s["passage"]
            body = plain(passage)
            flat = re.sub(r"[\n　 ]", "", body)
            n = len(flat)
            mark = "" if lo <= n <= hi else "  ← 目安の外"
            notes.append(f"{sid}: {n}字{mark}")
            if not lo <= n <= hi:
                errors.append(f"{sid}: 字数 {n} が目安 {lo}〜{hi} の外")

            if "{" in body or "}" in body or "|" in body:
                errors.append(f"{sid}: 文章のふりがなの書き方がくずれている")

            # 文章: ふりがな無しの部分に、小学校で習わない漢字がないか
            rubied_chars = set("".join(m.group(1) for m in RUBY.finditer(passage)))
            for ch in sorted(set(KANJI.findall(unrubied(passage)))):
                if ch not in ELEMENTARY and ch not in rubied_chars:
                    errors.append(f"{sid}: 文章の「{ch}」にふりがなが無い")
            rubied = [f"{m.group(1)}({m.group(2)})" for m in RUBY.finditer(passage)]
            notes.append(f"    ふりがな: {'、'.join(dict.fromkeys(rubied)) or 'なし'}")

            if len(s["questions"]) != 5:
                errors.append(f"{sid}: 設問が {len(s['questions'])} 問(5問のはず)")

            for i, q in enumerate(s["questions"], 1):
                n_q += 1
                qid = f"{sid} 問{i}"
                for key in ("kind", "q", "answer", "evidence", "steps"):
                    if not q.get(key):
                        errors.append(f"{qid}: {key} が無い")
                if q.get("focus") and q["focus"] not in body:
                    errors.append(f"{qid}: focus「{q['focus']}」が文章に無い")
                for ev in q.get("evidence", []):
                    if ev not in body:
                        errors.append(f"{qid}: evidence「{ev}」が文章に無い")
                    if "\n" in ev:
                        errors.append(f"{qid}: evidence が行をまたいでいる")
                texts = [q.get("q", ""), q.get("answer", "")] + list(q.get("steps", []))
                for t in texts:
                    if "{" in plain(t) or "}" in plain(t):
                        errors.append(f"{qid}: ふりがなの書き方がくずれている: {t}")
                    for ch in sorted(set(KANJI.findall(unrubied(t)))):
                        if ch not in ELEMENTARY and ch not in rubied_chars:
                            errors.append(f"{qid}: 「{ch}」にふりがなが無い: {t}")

    print(f"セット数: {n_sets} / 設問数: {n_q}")
    print("\n".join(notes))
    if errors:
        print(f"\n問題が {len(errors)} 件あります:")
        print("\n".join("  - " + e for e in errors))
        sys.exit(1)
    print("\n問題は見つかりませんでした。")


if __name__ == "__main__":
    main()
