# ddu-source-file_rec

File resursive source for ddu.vim

This source collects files in the path recursively.

## Required

### denops.vim

https://github.com/vim-denops/denops.vim

### ddu.vim

https://github.com/Shougo/ddu.vim

### ddu-kind-file

https://github.com/Shougo/ddu-kind-file

## Configuration

```vim
" Change source options.
call ddu#custom#patch_global('sourceParams', {
      \ 'file_rec': {'path': expand("~")},
      \ })

" Use file_rec source.
call ddu#start({'sources': [{'name': 'file_rec'}]})
```
