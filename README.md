# Requirements

* [Homebrew](https://brew.sh/)

## Setup on a new machine

These dotfiles are managed with [chezmoi](https://www.chezmoi.io/). The repo lives at `~/.local/share/chezmoi`.

* `brew install chezmoi`
* `chezmoi init --apply bagelbits` — clones this repo and writes the dotfiles into `~`
* `brew bundle --file ~/.local/share/chezmoi/Brewfile` — installs CLI tools, apps, fonts, and RunCat from the App Store
* `sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"`
* `bash -c "$(curl --fail --show-error --silent --location https://raw.githubusercontent.com/zdharma-continuum/zinit/HEAD/scripts/install.sh)"`
* [Setup ssh](https://docs.github.com/en/github/authenticating-to-github/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent) and [add to github](https://docs.github.com/en/github/authenticating-to-github/adding-a-new-ssh-key-to-your-github-account)
* WezTerm config is applied by chezmoi (Solarized Dark, Fira Code, transparency + blur); [background image](https://i.imgur.com/wimz70n.jpg)
* VSCode
  * [Setup command line](https://code.visualstudio.com/docs/setup/mac#_launching-from-the-command-line)
  * Turn on Settings Sync (restores extensions and settings)
* You might need to setup p10k again (`p10k configure`)
* [NVM](https://github.com/nvm-sh/nvm#installing-and-updating) — lazy loaded via zinit ([lukechilds/zsh-nvm](https://github.com/lukechilds/zsh-nvm))
* [RVM](https://rvm.io/rvm/install)
  * gpg comes from the Brewfile
  * You'll probably need to try a [different key server](https://rvm.io/rvm/security#install-our-keys).
* pyenv + [virtualenv](https://github.com/pyenv/pyenv-virtualenv) come from the Brewfile; `.zshrc` inits them when present

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

## Claude Code Setup

* [peon-ping](https://www.peonping.com/) for audio notifications comes from the Brewfile; set the pack with
  * `peon packs use dreamy-minimal`
