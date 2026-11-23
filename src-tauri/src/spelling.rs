use serde::{Deserialize, Serialize};
use spellbook::Dictionary;
use std::collections::HashMap;

pub const LICENSES: &str = concat!(
    "Spellbook 0.4.2 — MPL-2.0\nhttps://github.com/helix-editor/spellbook\n\n",
    include_str!("../dictionaries/spellbook-LICENSE"),
    "\n\nРусский словарь — Alexander I. Lebedev\n\n", include_str!("../dictionaries/ru/license"),
    "\n\nEnglish dictionary — SCOWL (en_US)\n\n", include_str!("../dictionaries/en/license"),
    "\n\nУкраїнський словник — GPL-3.0\nhttps://github.com/brown-uk/dict_uk\n\n", include_str!("../dictionaries/uk/license"),
    "\n\nИсходные словари: https://github.com/wooorm/dictionaries/tree/8cfea406b505e4d7df52d5a19bce525df98c54ab/dictionaries\n"
);

const MAX_TEXT: usize = 100_000;
const MAX_ISSUES: usize = 200;

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    Mixed,
    Ru,
    Uk,
    En,
}

#[derive(Deserialize)]
pub struct TextSegment {
    pub id: String,
    pub text: String,
}
#[derive(Serialize)]
pub struct SpellingIssue {
    pub segment: String,
    pub start: usize,
    pub length: usize,
    pub word: String,
    pub languages: Vec<Language>,
    pub mixed_alphabet: bool,
}
#[derive(Serialize)]
pub struct CheckResult {
    pub issues: Vec<SpellingIssue>,
    pub truncated: bool,
}

pub struct SpellChecker {
    ru: Dictionary,
    uk: Dictionary,
    en: Dictionary,
}
struct Word<'a> {
    text: &'a str,
    start: usize,
    length: usize,
}

fn apostrophe(c: char) -> bool {
    matches!(c, '\'' | '’' | 'ʼ')
}
fn letter(c: char) -> bool {
    c.is_alphabetic() && !apostrophe(c)
}
fn cyrillic(c: char) -> bool {
    ('\u{0400}'..='\u{052f}').contains(&c)
}
fn latin(c: char) -> bool {
    c.is_ascii_alphabetic()
}
fn normalized(word: &str) -> String {
    word.chars()
        .filter(|c| *c != '\u{0301}')
        .map(|c| if apostrophe(c) { '\'' } else { c })
        .collect()
}
fn words(text: &str) -> Vec<Word<'_>> {
    let chars: Vec<_> = text.char_indices().collect();
    let mut result = Vec::new();
    let mut i = 0;
    let mut utf16 = 0;
    let mut unit_end = 0;
    let mut skip_unit = false;
    while i < chars.len() {
        let (byte, ch) = chars[i];
        if !letter(ch) {
            utf16 += ch.len_utf16();
            i += 1;
            continue;
        }
        let start = utf16;
        let first = i;
        while i < chars.len() {
            let c = chars[i].1;
            let joining = (apostrophe(c) || c == '-')
                && i > first
                && chars.get(i + 1).is_some_and(|(_, next)| letter(*next));
            if !letter(c) && c != '\u{0301}' && !joining {
                break;
            }
            utf16 += c.len_utf16();
            i += 1;
        }
        let end = chars.get(i).map_or(text.len(), |(at, _)| *at);
        let word = &text[byte..end];
        // Skip URLs, mail, paths, identifiers and digit-bearing tokens as whole units.
        if byte >= unit_end {
            let unit_start = text[..byte].rfind(char::is_whitespace).unwrap_or(0);
            unit_end = byte
                + text[byte..]
                    .find(char::is_whitespace)
                    .unwrap_or(text.len() - byte);
            let unit = &text[unit_start..unit_end];
            skip_unit = unit.contains("://")
                || unit.contains('@')
                || unit.contains('_')
                || unit.contains('/')
                || unit.contains('\\')
                || unit.chars().any(|c| c.is_numeric());
        }
        if skip_unit {
            continue;
        }
        if word.chars().count() <= 64 {
            result.push(Word {
                text: word,
                start,
                length: utf16 - start,
            });
        }
    }
    result
}

impl SpellChecker {
    pub fn new() -> Result<Self, String> {
        let load = |aff, dic| {
            Dictionary::new(aff, dic)
                .map_err(|_| "Не удалось загрузить встроенный словарь орфографии.".to_string())
        };
        Ok(Self {
            ru: load(
                include_str!("../dictionaries/ru/index.aff"),
                include_str!("../dictionaries/ru/index.dic"),
            )?,
            uk: load(
                include_str!("../dictionaries/uk/index.aff"),
                include_str!("../dictionaries/uk/index.dic"),
            )?,
            en: load(
                include_str!("../dictionaries/en/index.aff"),
                include_str!("../dictionaries/en/index.dic"),
            )?,
        })
    }
    fn dictionary(&self, language: Language) -> &Dictionary {
        match language {
            Language::Ru => &self.ru,
            Language::Uk => &self.uk,
            _ => &self.en,
        }
    }
    fn context(&self, words: &[Word<'_>]) -> Option<Language> {
        let (mut ru, mut uk) = (0usize, 0usize);
        for word in words {
            let value = normalized(word.text);
            if value.chars().any(latin) {
                continue;
            }
            let lower = value.to_lowercase();
            if lower.contains(['ы', 'э', 'ъ', 'ё']) {
                ru += 2;
            }
            if lower.contains(['і', 'ї', 'є', 'ґ']) {
                uk += 2;
            }
            match (self.ru.check(&value), self.uk.check(&value)) {
                (true, false) => ru += 1,
                (false, true) => uk += 1,
                _ => {}
            }
        }
        if ru >= uk + 2 {
            Some(Language::Ru)
        } else if uk >= ru + 2 {
            Some(Language::Uk)
        } else {
            None
        }
    }
    fn languages(&self, word: &str, mode: Language, context: Option<Language>) -> Vec<Language> {
        if mode != Language::Mixed {
            return vec![mode];
        }
        let lower = word.to_lowercase();
        let has_latin = lower.chars().any(latin);
        let has_cyrillic = lower.chars().any(cyrillic);
        if has_latin && !has_cyrillic {
            return vec![Language::En];
        }
        if lower.contains(['і', 'ї', 'є', 'ґ']) && !lower.contains(['ы', 'э', 'ъ', 'ё']) {
            return vec![Language::Uk];
        }
        if lower.contains(['ы', 'э', 'ъ', 'ё']) {
            return vec![Language::Ru];
        }
        context.map_or_else(
            || vec![Language::Ru, Language::Uk],
            |language| vec![language],
        )
    }
    pub fn check(&self, segments: &[TextSegment], mode: Language) -> Result<CheckResult, String> {
        if segments.len() > 1000
            || segments.iter().map(|s| s.text.len()).sum::<usize>() > MAX_TEXT * 4
            || segments
                .iter()
                .map(|s| s.text.encode_utf16().count())
                .sum::<usize>()
                > MAX_TEXT
            || segments.iter().any(|s| s.id.len() > 128)
        {
            return Err("Для одной проверки доступно до 100 000 символов и 1000 фрагментов. Сократите текст или проверяйте его частями.".into());
        }
        let mut issues = Vec::new();
        let mut cache: HashMap<(String, Language), bool> = HashMap::new();
        for segment in segments {
            let all_tokens = words(&segment.text);
            let mut token_index = 0;
            let mut offset = 0;
            for sentence in segment.text.split_inclusive(['.', '!', '?', '\n', ';']) {
                let sentence_end = offset + sentence.encode_utf16().count();
                let first = token_index;
                while token_index < all_tokens.len() && all_tokens[token_index].start < sentence_end
                {
                    token_index += 1;
                }
                let tokens = &all_tokens[first..token_index];
                let context = if mode == Language::Mixed {
                    self.context(tokens)
                } else {
                    None
                };
                for token in tokens {
                    let word = normalized(token.text);
                    let languages = self.languages(&word, mode, context);
                    let mixed_alphabet = word.chars().any(latin) && word.chars().any(cyrillic);
                    let accepted = !mixed_alphabet
                        && languages.iter().any(|&language| {
                            *cache
                                .entry((word.clone(), language))
                                .or_insert_with(|| self.dictionary(language).check(&word))
                        });
                    if !accepted {
                        if issues.len() == MAX_ISSUES {
                            return Ok(CheckResult {
                                issues,
                                truncated: true,
                            });
                        }
                        issues.push(SpellingIssue {
                            segment: segment.id.clone(),
                            start: token.start,
                            length: token.length,
                            word: token.text.into(),
                            languages,
                            mixed_alphabet,
                        });
                    }
                }
                offset += sentence.encode_utf16().count();
            }
        }
        Ok(CheckResult {
            issues,
            truncated: false,
        })
    }
    pub fn suggestions(&self, word: &str, languages: &[Language]) -> Result<Vec<String>, String> {
        if word.chars().count() > 64
            || word.is_empty()
            || word
                .chars()
                .any(|c| !letter(c) && !apostrophe(c) && c != '-' && c != '\u{0301}')
            || languages.is_empty()
            || languages.len() > 3
            || languages.contains(&Language::Mixed)
        {
            return Err("Некорректный запрос вариантов исправления.".into());
        }
        let mut suggestions = Vec::new();
        for &language in languages {
            let mut values = Vec::new();
            self.dictionary(language)
                .suggest(&normalized(word), &mut values);
            for value in values.into_iter().take(5) {
                if !suggestions.contains(&value) {
                    suggestions.push(value);
                }
            }
        }
        suggestions.truncate(8);
        Ok(suggestions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::OnceLock;
    fn checker() -> &'static SpellChecker {
        static CHECKER: OnceLock<SpellChecker> = OnceLock::new();
        CHECKER.get_or_init(|| SpellChecker::new().expect("Bundled dictionaries must parse"))
    }
    fn check(text: &str, language: Language) -> CheckResult {
        checker()
            .check(
                &[TextSegment {
                    id: "body".into(),
                    text: text.into(),
                }],
                language,
            )
            .unwrap()
    }
    #[test]
    fn bundled_dictionaries_accept_real_words_and_inflections() {
        assert!(check("Сегодня мы проверяем русский текст.", Language::Ru)
            .issues
            .is_empty());
        assert!(
            check("Сьогодні ми перевіряємо український текст.", Language::Uk)
                .issues
                .is_empty()
        );
        assert!(check("Please check the configuration.", Language::En)
            .issues
            .is_empty());
        assert!(check("п'ять п’ять пʼять", Language::Uk).issues.is_empty());
    }
    #[test]
    fn mixed_text_switches_between_sentences_and_latin_words() {
        let result = check("Сегодня обсуждали deployment приложения. Треба перевірити налаштування. Please check the configuration.", Language::Mixed);
        assert!(
            result.issues.is_empty(),
            "{:?}",
            result
                .issues
                .iter()
                .map(|issue| &issue.word)
                .collect::<Vec<_>>()
        );
        let result = check(
            "Это русский текст: ашипка. Український текст: налаштуваня. English helllo.",
            Language::Mixed,
        );
        assert_eq!(
            result
                .issues
                .iter()
                .map(|issue| issue.word.as_str())
                .collect::<Vec<_>>(),
            ["ашипка", "налаштуваня", "helllo"]
        );
        assert_eq!(result.issues[0].languages, [Language::Ru]);
        assert_eq!(result.issues[1].languages, [Language::Uk]);
        assert_eq!(result.issues[2].languages, [Language::En]);
    }
    #[test]
    fn ambiguous_fragments_use_both_cyrillic_dictionaries_and_manual_mode_is_strict() {
        assert_eq!(
            checker().languages("текст", Language::Mixed, None),
            [Language::Ru, Language::Uk]
        );
        assert!(!check("український", Language::Ru).issues.is_empty());
        assert!(!check("русский", Language::Uk).issues.is_empty());
    }
    #[test]
    fn offsets_are_utf16_and_mixed_alphabets_are_always_reported() {
        let result = check("😀 привітт pусский", Language::Mixed);
        assert_eq!(result.issues[0].start, 3);
        assert_eq!(result.issues[0].length, 7);
        assert!(result
            .issues
            .iter()
            .any(|issue| issue.word == "pусский" && issue.mixed_alphabet));
    }
    #[test]
    fn urls_emails_and_identifiers_are_not_checked_as_prose() {
        assert!(check(
            "https://example.invalid/somethng user@example.invalid snake_case path/file123.rs",
            Language::Mixed
        )
        .issues
        .is_empty());
    }
    #[test]
    fn suggestions_use_the_requested_dictionary() {
        assert!(checker()
            .suggestions("helllo", &[Language::En])
            .unwrap()
            .iter()
            .any(|word| word == "hello"));
        assert!(checker()
            .suggestions("превет", &[Language::Ru])
            .unwrap()
            .iter()
            .any(|word| word == "привет"));
        assert!(checker()
            .suggestions("привітт", &[Language::Uk])
            .unwrap()
            .iter()
            .any(|word| word == "привіт"));
        assert!(checker().suggestions("word", &[Language::Mixed]).is_err());
    }
    #[test]
    fn oversized_requests_are_rejected_and_issue_limit_is_explicit() {
        assert!(checker()
            .check(
                &[TextSegment {
                    id: "body".into(),
                    text: "а".repeat(MAX_TEXT + 1)
                }],
                Language::Ru
            )
            .is_err());
        let result = check(&"zzzzzzzz ".repeat(MAX_ISSUES + 1), Language::En);
        assert_eq!(result.issues.len(), MAX_ISSUES);
        assert!(result.truncated);
        let result = check("", Language::Mixed);
        assert!(result.issues.is_empty());
    }
}
