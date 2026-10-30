// Code block colours (Settings > Editor): a theme for all code blocks, and optionally another
// one per language. Plain data (React Native uses it for the settings screens too). Themes
// set CSS variables read by content.css; "app" follows the app's own palette.

export interface CodeTheme {
  id: string;
  label: string;
  // null = the app's colours (content.css defaults).
  vars: Record<string, string> | null;
}

const theme = (id: string, label: string, c: [bg: string, fg: string, keyword: string, string: string, number: string, comment: string, fn: string, type: string, variable: string, attr: string, meta: string, tag: string]): CodeTheme => ({
  id,
  label,
  vars: {
    '--code-bg': c[0], '--code-fg': c[1], '--code-keyword': c[2], '--code-string': c[3], '--code-number': c[4], '--code-comment': c[5],
    '--code-function': c[6], '--code-type': c[7], '--code-variable': c[8], '--code-attr': c[9], '--code-meta': c[10], '--code-tag': c[11],
  },
});

export const CODE_THEMES: CodeTheme[] = [
  { id: 'app', label: 'App colours', vars: null },
  theme('github-dark', 'GitHub Dark', ['#0d1117', '#e6edf3', '#ff7b72', '#a5d6ff', '#79c0ff', '#8b949e', '#d2a8ff', '#ffa657', '#ffa657', '#79c0ff', '#8b949e', '#7ee787']),
  theme('github-light', 'GitHub Light', ['#f6f8fa', '#1f2328', '#cf222e', '#0a3069', '#0550ae', '#6e7781', '#8250df', '#953800', '#953800', '#0550ae', '#6e7781', '#116329']),
  theme('one-dark', 'One Dark', ['#282c34', '#abb2bf', '#c678dd', '#98c379', '#d19a66', '#5c6370', '#61afef', '#e5c07b', '#e06c75', '#d19a66', '#56b6c2', '#e06c75']),
  theme('dracula', 'Dracula', ['#282a36', '#f8f8f2', '#ff79c6', '#f1fa8c', '#bd93f9', '#6272a4', '#50fa7b', '#8be9fd', '#f8f8f2', '#50fa7b', '#ff79c6', '#ff79c6']),
  theme('monokai', 'Monokai', ['#272822', '#f8f8f2', '#f92672', '#e6db74', '#ae81ff', '#75715e', '#a6e22e', '#66d9ef', '#fd971f', '#a6e22e', '#f92672', '#f92672']),
  theme('catppuccin', 'Catppuccin Mocha', ['#1e1e2e', '#cdd6f4', '#cba6f7', '#a6e3a1', '#fab387', '#6c7086', '#89b4fa', '#f9e2af', '#f38ba8', '#f9e2af', '#94e2d5', '#89b4fa']),
  theme('nord', 'Nord', ['#2e3440', '#d8dee9', '#81a1c1', '#a3be8c', '#b48ead', '#616e88', '#88c0d0', '#8fbcbb', '#d8dee9', '#8fbcbb', '#5e81ac', '#81a1c1']),
  theme('gruvbox', 'Gruvbox Dark', ['#282828', '#ebdbb2', '#fb4934', '#b8bb26', '#d3869b', '#928374', '#8ec07c', '#fabd2f', '#83a598', '#fabd2f', '#fe8019', '#8ec07c']),
  theme('solarized-light', 'Solarized Light', ['#fdf6e3', '#657b83', '#859900', '#2aa198', '#d33682', '#93a1a1', '#268bd2', '#b58900', '#cb4b16', '#b58900', '#6c71c4', '#268bd2']),
];

export const codeThemeVars = (id: string | null | undefined): Record<string, string> | null => CODE_THEMES.find((t) => t.id === id)?.vars ?? null;

// The languages a code block can be set to (grammars registered in code-block.ts).
export const CODE_LANGUAGES: [id: string, label: string][] = [
  ['plaintext', 'Plain text'], ['arduino', 'Arduino'], ['armasm', 'ARM assembly'], ['x86asm', 'Assembly x86'], ['bash', 'Bash'], ['dos', 'Batch (cmd)'],
  ['bnf', 'BNF'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['cmake', 'CMake'], ['css', 'CSS'], ['dart', 'Dart'], ['diff', 'Diff'],
  ['dockerfile', 'Dockerfile'], ['ebnf', 'EBNF'], ['elixir', 'Elixir'], ['erlang', 'Erlang'], ['fsharp', 'F#'], ['glsl', 'GLSL'], ['go', 'Go'],
  ['gradle', 'Gradle'], ['graphql', 'GraphQL'], ['groovy', 'Groovy'], ['haskell', 'Haskell'], ['xml', 'HTML / XML'], ['http', 'HTTP'],
  ['ini', 'INI / TOML'], ['java', 'Java'], ['javascript', 'JavaScript'], ['json', 'JSON'], ['julia', 'Julia'], ['kotlin', 'Kotlin'],
  ['latex', 'LaTeX'], ['less', 'Less'], ['lisp', 'Lisp'], ['lua', 'Lua'], ['makefile', 'Makefile'], ['markdown', 'Markdown'],
  ['matlab', 'MATLAB / Octave (.m)'], ['mipsasm', 'MIPS assembly'], ['nginx', 'Nginx'], ['objectivec', 'Objective-C'], ['ocaml', 'OCaml'],
  ['perl', 'Perl'], ['php', 'PHP'], ['powershell', 'PowerShell'], ['prolog', 'Prolog'], ['properties', 'Properties'], ['protobuf', 'Protocol Buffers'],
  ['python', 'Python'], ['python-repl', 'Python REPL'], ['r', 'R'], ['ruby', 'Ruby'], ['rust', 'Rust'], ['scala', 'Scala'], ['scheme', 'Scheme'],
  ['scss', 'SCSS'], ['shell', 'Shell session'], ['sql', 'SQL'], ['swift', 'Swift'], ['typescript', 'TypeScript'], ['verilog', 'Verilog'],
  ['vhdl', 'VHDL'], ['vbnet', 'Visual Basic'], ['wasm', 'WebAssembly'], ['xaml', 'XAML'], ['yaml', 'YAML'],
];

export const codeLanguageLabel = (id: string | null | undefined): string => CODE_LANGUAGES.find(([l]) => l === id)?.[1] ?? id ?? 'Plain text';
