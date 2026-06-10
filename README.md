# Requirements

* [Homebrew](https://brew.sh/)

## Setup on a new machine

These dotfiles are managed with [chezmoi](https://www.chezmoi.io/). The repo lives at `~/.local/share/chezmoi`.

One command does it all (Homebrew, chezmoi + dotfiles, Brewfile, oh-my-zsh, zinit, SSH key, RVM, peon-ping):

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/bagelbits/dotfiles/main/install.sh)"
```

The script is idempotent — re-run it any time. It prints the few steps that stay manual:

* Sign into the App Store (RunCat comes via `mas`), then re-run if it failed
* Add the generated SSH key to [GitHub](https://github.com/settings/ssh/new) (the script copies it to your clipboard)
* WezTerm config is applied by chezmoi (Solarized Dark, Fira Code, transparency + blur); [background image](https://i.imgur.com/wimz70n.jpg)
* VSCode
  * [Setup command line](https://code.visualstudio.com/docs/setup/mac#_launching-from-the-command-line)
  * Turn on Settings Sync (restores extensions and settings)
* You might need to setup p10k again (`p10k configure`)

## Machine-local config and secrets

Anything machine-specific or secret stays out of this repo in untracked files:

* `~/.zshrc.local` — sourced at the end of `.zshrc`. Put exports like `NPM_TOKEN` and `LINEAR_API_KEY` here.
* `~/.gitconfig.local` — included from `.gitconfig`. Holds per-machine values like the coderabbit `machineId`.

## Day-to-day chezmoi

* `chezmoi edit ~/.zshrc` then `chezmoi apply` — edit the source copy and write it to `~`
* `chezmoi add ~/.zshrc` — pull in changes after a tool appends to a managed file (installers love doing this)
* `chezmoi diff` — see drift between the repo and `~`
* `chezmoi cd` — drop into the repo to commit and push
* `chezmoi update` — pull and apply on another machine
