# ddu-source-file_rec

File recursive source for ddu.vim

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
call ddu#start(#{ sources: [#{ name: 'file_rec' }] })

" Change base path.
" NOTE: "path" must be full path.
call ddu#custom#patch_global('sourceOptions', #{
      \   file_rec: #{ path: expand("~") },
      \ })
```
