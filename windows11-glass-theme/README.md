# Glass Dock — Tema Windows 11

Pacote de personalização para aproximar o Windows 11 do visual **glassmorphism** do mockup:

- wallpaper azul com fitas fluidas
- barra de pesquisa flutuante no topo
- taskbar em formato **dock** (pill) centrada
- janelas com cantos bem arredondados e efeito Mica/Acrylic
- ícones coloridos e minimalistas

> O Windows 11 nativo não permite recriar 100% o File Explorer conceptual (tabs em baixo, cards Quick Access, tags). Este pacote usa ferramentas gratuitas e configs prontas para chegar o mais perto possível.

---

## Resultado esperado

| Elemento | Como obter |
|---|---|
| Wallpaper azul glass | `assets/wallpaper.svg` → PNG (ou use o gerador) |
| Tema claro + transparência | `GlassDock.theme` + script |
| Dock flutuante | RoundedTB + TranslucentTB |
| Blur/Mica nas janelas | MicaForEveryone / ExplorerBlurMica |
| Pesquisa flutuante | Rainmeter skin incluída |
| Ícones coloridos | links no README (Fluent / Colorful) |

---

## Instalação rápida

### 1. Pré-requisitos

Instale (winget ou download manual):

```powershell
winget install Rainmeter.Rainmeter
winget install TranslucentTB.TranslucentTB
# RoundedTB e MicaForEveryone: veja links em docs/FERRAMENTAS.md
```

Ferramentas recomendadas:

1. **[RoundedTB](https://github.com/torchgm/RoundedTB)** — taskbar em pill / dock
2. **[TranslucentTB](https://github.com/TranslucentTB/TranslucentTB)** — transparência da taskbar
3. **[MicaForEveryone](https://github.com/MicaForEveryone/MicaForEveryone)** — Mica/Acrylic nas janelas
4. **[Rainmeter](https://www.rainmeter.net/)** — barra de pesquisa flutuante
5. **[Windhawk](https://windhawk.net/)** (opcional) — mods de Explorer / Start
6. Pack de ícones: **Fluent** / **Windows 11 SE** / **Colorful Folder** (DeviantArt / IconArchive)

### 2. Aplicar o tema

No PowerShell **como Administrador**:

```powershell
cd caminho\para\windows11-glass-theme
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Apply-GlassDock.ps1
```

O script:

- copia o wallpaper
- aplica o ficheiro `.theme`
- ativa transparência do Windows
- centra ícones da taskbar
- gera configs para RoundedTB / TranslucentTB / MicaForEveryone
- opcionalmente instala a skin Rainmeter

### 3. Configurar o dock (RoundedTB)

1. Abra RoundedTB
2. Importe `configs/RoundedTB.json` **ou** use:
   - Corner radius: `18`
   - Margin: `12` (todos os lados)
   - Dynamic mode: **ligado** (encolhe como dock)
3. Combine com TranslucentTB → estilo **Clear** / Acrylic claro

### 4. Blur nas janelas

Importe `configs/MicaForEveryone.conf`:

- File Explorer → Acrylic light, opacity ~80%
- Cantos arredondados via Windhawk mod *Windows 11 Taskbar Styler* / *Explorer* (se disponível)

### 5. Barra de pesquisa flutuante

1. Abra Rainmeter
2. Clique direito → Skins → `GlassDockSearch` → `Search.ini`
3. Posicione no topo centro (a skin já vem centrada)

---

## Pré-visualização

Abra no browser:

```
preview/index.html
```

Mostra o layout conceptual (desktop + dock + Explorer glass) para referência visual.

---

## Estrutura

```
windows11-glass-theme/
├── GlassDock.theme          # tema Windows
├── README.md
├── assets/
│   ├── wallpaper.svg        # wallpaper vetorial
│   ├── generate-wallpaper.ps1
│   └── icons/               # placeholders / guias de ícones
├── configs/
│   ├── RoundedTB.json
│   ├── TranslucentTB.json
│   ├── MicaForEveryone.conf
│   └── registry-tweaks.reg
├── rainmeter/
│   └── GlassDockSearch/
│       └── Search.ini
├── scripts/
│   ├── Apply-GlassDock.ps1
│   └── Restore-Default.ps1
└── preview/
    └── index.html
```

---

## Reverter

```powershell
.\scripts\Restore-Default.ps1
```

Desative também RoundedTB / TranslucentTB / MicaForEveryone / Rainmeter.

---

## Notas

- Testado conceptualmente para **Windows 11 22H2+**.
- Algumas ferramentas exigem desativar temporariamente o Windows Defender SmartScreen.
- O Explorer real não tem tabs em baixo nem secção Tags como no mockup — isso é apenas conceptual no `preview/`.
- Faça um ponto de restauro do sistema antes de aplicar tweaks de registo.
