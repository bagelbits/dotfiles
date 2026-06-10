# Requirements

* [Homebrew](https://brew.sh/)

## Setup (this will require some tuning)

* `brew bundle` — installs everything in the [Brewfile](Brewfile): CLI tools, apps, fonts, and RunCat from the App Store
* WezTerm
  * config lives in [.config/wezterm/wezterm.lua](.config/wezterm/wezterm.lua) (Solarized Dark, Fira Code, transparency + blur)
  * copy it to `~/.config/wezterm/wezterm.lua`
  * [Background behind WezTerm](https://i.imgur.com/wimz70n.jpg)
* `sh -c "$(curl -fsSL https://raw.githubusercontent.com/robbyrussell/oh-my-zsh/master/tools/install.sh)"`
* `bash -c "$(curl --fail --show-error --silent --location https://raw.githubusercontent.com/zdharma-continuum/zinit/HEAD/scripts/install.sh)"`
* [Setup ssh](https://docs.github.com/en/github/authenticating-to-github/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent) and [add to github](https://docs.github.com/en/github/authenticating-to-github/adding-a-new-ssh-key-to-your-github-account)
* VSCode
  * [Setup command line](https://code.visualstudio.com/docs/setup/mac#_launching-from-the-command-line)
  * Turn on Settings Sync (restores extensions and settings)
* Drop files into ~ from here and reload terminal
  * You might need to setup p10k again
* [NVM](https://github.com/nvm-sh/nvm#installing-and-updating) — lazy loaded via zinit ([lukechilds/zsh-nvm](https://github.com/lukechilds/zsh-nvm))
* [RVM](https://rvm.io/rvm/install)
  * gpg comes from the Brewfile
  * You'll probably need to try a [different key server](https://rvm.io/rvm/security#install-our-keys).
* pyenv + [virtualenv](https://github.com/pyenv/pyenv-virtualenv) come from the Brewfile; init lines are already in `.zshrc`
* Generate a new NPM token and add it to your `.zshrc` file

## Claude Code Setup

* [peon-ping](https://www.peonping.com/) for audio notifications comes from the Brewfile; set the pack with
  * `peon packs use dreamy-minimal`
