# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing since the last release._

## [1.5.0] - 2026-10-23

### Added

- 2026-10-23 **listen**: the controls sit in a pill at the top right, beside the tracks pill ([#36](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/36))
- 2026-10-23 **listen**: the Full player link continues where the flashcards' player is ([#34](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/34))
- 2026-10-23 **listen**: albums up top as cover tiles, the tracklist a pill that names the playing track, the controls riding the line being read ([#32](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/32))
- 2026-10-23 **listen**: Listen is a flashcard mode -- the card body is the player, the controls an overlay on the block being read, the pill gone ([#31](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/31))
- 2026-10-23 **listen**: the spoken answer albums, playable with the guide -- a Listen page, a pill beside the flashcards, speed from quarter to double, read-along from the .lrc ([#28](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/28))

### Fixed

- 2026-10-23 **listen**: no HRV anywhere in the app -- the credit and the albums retagged to the site's name ([#35](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/35))
- 2026-10-23 **listen**: the study page loads the player's stylesheet, the read-along keeps its line in view, the pill carries every tool, and answers read in green ([#29](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/29))
- 2026-10-01 **ci**: pruning a lab payload that a concurrent build already pruned is not a failure ([#26](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/26))

## [1.4.0] - 2026-10-01

### Added

- 2026-10-01 **home**: Start here lists Call signs beside the Study guide ([#24](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/24))

## [1.3.1] - 2026-10-01

### Changed

- 2026-10-01 **shell**: sync tcos-app#12 -- the way-back pill links the section you are reading ([#21](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/21))
- 2026-10-01 **shell**: sync tcos-app#11 -- print opt-in, flex stats row ([#20](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/20))

## [1.3.0] - 2026-09-29

### Added

- 2026-09-29 **shell**: hamburger menu for the header on small screens ([#17](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/17))
- 2026-09-29 **study**: real-world use on term/formula cards; way-back pill; exam Score dock and result cards ([#16](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/16))
- 2026-09-29 **study**: flip mode for flashcards; flip cards in Glossary and Formulas; tap the back to flip back ([#15](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/15))
- 2026-09-29 **study**: flip cards in Guide and Browse; keep formula triangle letters in dark mode ([#14](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/14))
- 2026-09-29 **study**: mastery map follows the shell palette ([#12](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/12))
- 2026-09-29 **study**: inherit tcos-app's shared shell; collapsible, columnar, readable-first study UI ([#11](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/11))

### Fixed

- 2026-09-29 **study**: columns lay out groups in Guide/Browse; cool neutral palette ([#13](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/13))
- 2026-09-29 **study**: show each form of a formula on its own line ([#10](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/10))

### Changed

- 2026-09-29 **study**: use the shell's flip card, way-back pill and dock ([#18](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/18))

## [1.2.0] - 2026-09-29

### Added

- 2026-09-29 **site**: rename to Just Another Ham Study and add the og image ([#8](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/8))

## [1.1.0] - 2026-09-29

### Added

- 2026-09-29 **study**: Glossary and Formulas tabs, authored content, HamStudy.org link ([#5](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/5))
- 2026-09-29 **site**: the ham study guide, self-contained, with its NCVEC pools ([#4](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/4))

### Changed

- 2026-09-29 fail when an NCVEC question pool ends within 90 days ([#6](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/6))

## [1.0.0] - 2026-09-29

### Added

- 2026-09-29 walking skeleton for ham.tcos.app ([#1](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/1))

### Fixed

- 2026-09-29 **deploy**: lab host is ham-app.lab.tcos.us ([#2](https://github.com/Twin-Cities-Open-Systems/ham-tcos-app/pull/2))
