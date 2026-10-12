# sm64js

### Links
[Main Website: sm64js.com](https://sm64js.com)

[Discord Server](https://discord.gg/7UaDnJt)

## What is this?
This is an ongoing work-in-progress port of the decompilation of original Nintendo game, Super Mario 64, to native Javascript (no emulation or web assembly). The project involved creating a Javascript WebGL port of N64 Fast 3D Renderer, originally implemented with OpenGL in C.  This project also includes the development of online mass multiplayer versions of sm64js and other custom multiplayer game modes.

## Build instructions - Windows, Mac, or Linux

### Prerequisites
* Node.js

### Run these commands
```bash
# Clone the source code
git clone https://github.com/sm64js/sm64js.git && cd sm64js
# Install node packages
npm install
# Launch wepback dev server
npm run start
```

### To update your project
```bash
# update folder (be inside sm64js)
git pull
# Launch server
npm run start
```

You should now be able to access the website with the game from a web browser by typing "localhost" into the address bar.

## Audio

Original Mario sound effects, voices, jingles and level music play from the
US ROM you supply. After upgrading from an older build, select your ROM again
once to add its audio banks to the local asset cache. Click **Start Game** to
enable audio; with autostart, click the page or press a key. **Mute audio** is
available in the top right. Playback pauses while the tab is hidden.

The title screen with Mario's face plays the original title theme, and the
file and star select menus play their own themes. Music follows each area's
original music setting. Starting in the Castle Grounds also plays the original
title theme; it yields to level music when you enter
another area. Returning to the grounds uses its normal outdoor ambience.

The audio engine uses [libsm64](https://github.com/libsm64/libsm64), compiled to
WebAssembly. Its source, license and reproducible build instructions are in
[vendor/libsm64-audio](vendor/libsm64-audio/README.md). No ROM audio is bundled
or fetched from another server.

## Gamepad

Default gamepad controls are laid out for a Nintendo Switch Pro Controller,
following Super Mario 3D All-Stars:

| Switch Pro Controller | Action |
| --- | --- |
| Left stick | Move |
| Right stick | Camera (C buttons) |
| A | Jump |
| B | Punch, kick and fire |
| ZL | Crouch (N64 Z) |
| R | Change camera mode |
| + | Start / pause |
| ZR | Aim |
| L | Next gun |

Buttons are read by position in the browser's standard gamepad layout, so
other controllers work with the same layout: the bottom face button is B and
the right face button is A. Every button can be remapped in the gamepad
controls panel. If you saved custom controls before, choose **Load Default
Controls** to switch to this layout.

## Garden car

A 1965 Ford Mustang convertible is parked on the starting lawn in the Castle
Grounds (Main Map).
Walk up to it and press **E** or the game's **B** button to get in or out.
As in GTA San Andreas, Mario walks to the driver's door (round the car if he's on
the far side), lines up and vaults over the convertible's door into his seat;
Luigi hops into the passenger seat. To get out, Mario climbs over the door once
the car has stopped (it brakes for you if you're rolling slowly), or dives out
and rolls clear at around 40–90 km/h, leaving the empty car to coast on.
Use **Up** to accelerate, **Down** to brake and then reverse, and **Left / Right**
to steer. The gamepad's left stick works too. The jump button is the handbrake
and crouch is the footbrake (**Space / Z** with the default keyboard controls).

It drives like a GTA San Andreas car: its handling is ported from
[gta-reversed](https://github.com/gta-reversed/gta-reversed)'s vehicle code. The
car rides on four sprung, damped wheels, each with GTA's tyre friction circle, so
the rear-drive Mustang spins its tyres off the line, works through five gears to
about 165 km/h, understeers if you turn in too fast and slides when you pull the
handbrake. It pitches under acceleration and braking, leans in corners and banks
with the terrain, can drive off ledges and glances off walls. It won't enter
deep water, lava or death floors. SA's per-car `handling.cfg` and surface grip
table aren't part of gta-reversed, so the Mustang's handling values and tyre grip
are tuned approximations in the same format. Exit into an open space beside it;
if there isn't room, move to another patch of grass first. It stays parked when
you exit and resets when the Castle Grounds reloads.

The car model is
["1965 Ford Mustang Convertible"](https://sketchfab.com/3d-models/1965-ford-mustang-convertible-05f2a294087541ab82f681136d134344)
by [Kristian LaGrange](https://sketchfab.com/kristian123), licensed under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). It was simplified from
about 112,000 to 4,200 triangles and its textures were baked into vertex colours.
The original is kept in `src/actors/garden_car/source/`; to rebuild the game
model after changing it, run:

```bash
node otherTools/convertCarGlb.mjs src/actors/garden_car/source/1965_ford_mustang_convertible.glb src/actors/garden_car/model.inc.js
```

Luigi joins Mario on the starting lawn, wearing a green outfit and L cap.
He follows Mario's path around the Castle Grounds, easing between walking and
running. When Mario stands still for a moment, Luigi wanders the nearby lawn by
himself: he walks or runs to spots within reach, looks around, and sometimes hops,
while avoiding the moat, steep slopes and walls. Once Mario moves on, Luigi runs
back and follows again. He automatically rides in the passenger seat when Mario
enters the car, and follows again after Mario exits.

While riding, Luigi delivers contextual crime-game-style banter with subtitles
above the driving controls. His audible reactions reuse Mario's original ROM
exclamations at 1.18× pitch/speed; the recordings do not speak the full subtitle
sentences. Mario's voice and the music keep their normal pitch. Dialogue respects
the audio mute button, pauses between lines, and stops when you leave the car.

## Build instructions With Docker - Windows, Mac, or Linux

### First install Docker
* Windows - [Install Instructions](https://docs.docker.com/docker-for-windows/install-windows-home/)
* Mac - [Install Instructions](https://docs.docker.com/docker-for-mac/install/)
* Linux - [Install Instructions](https://docs.docker.com/engine/install/#server)

### Run these commands
```bash
# Create and start lightweight docker container with NodeJs
docker run --name mySm64JsServer -dp 80:80 node:13 tail -f /dev/null
# Connect to the docker container's shell
docker exec -it mySm64JsServer /bin/sh

# Install additional prerequisites
apk update && apk add git
# Clone the source code
git clone https://github.com/sm64js/sm64js.git && cd sm64js

# Install node packages, build, and serve
npm run build 
npm run serve

```
You should now be able to access the website with the game from a web browser by typing "localhost" into the address bar.

## Neat gLinker commands you can run in the console
Because of a good portion of the game existing under the gLinker object within the window object, you can manipulate these portions of code to make certain things happen.

Drain the Castle Grounds moat:
```js
const gEnvironmentRegions = gLinker.ObjectListProcessor.gEnvironmentRegions
gEnvironmentRegions[6] = -800
gEnvironmentRegions[12] = -800
```

Access Mario's state:
```js
gLinker.LevelUpdate.gMarioState.key = value
```
With this, you can make Mario fly, go fast, and a lot of other things.

### Related Projects
[Super Mario 64 Decomp](https://github.com/n64decomp/sm64)
 - Team that decompiled the original Super Mario 64 ROMs into C source code

[Super Mario 64 PC Port](https://github.com/sm64-port/sm64-port)
 - Team that ported the decompiled project to PC

[N64 Fast 3D Renderer](https://github.com/Emill/n64-fast3d-engine)
 - OpenGL Implementation of a 3D renderer for the Nintendo 64's graphics
(For this project, it was re-implemented in Javascript and WebGL)



## Aiming

Hold **Q** (or **ZR** on the gamepad) to draw Mario's pistol. Like GTA San
Andreas, he locks on to the enemy that is closest to where the camera is
looking, weighing distance and angle, and skips enemies behind walls or hills.
A marker above the target shows its health from green to red. While aiming, the
stick strafes (Mario walks forward or back, or sidesteps, keeping the gun on the target), **C-left / C-right** (**J / L**) switch to the next enemy on
that side, and jump cancels the aim. The targeting is ported from
[gta-reversed](https://github.com/gta-reversed/gta-reversed)
(`CPlayerPed::EvaluateTarget` and related functions).

Press **B** while aiming to fire (hold it for automatic weapons) and **R** (or
**L** on the gamepad) to switch guns. Enemies have GTA-style health (100, or 250
for Bullies and Chuckyas). When it runs out, Bob-ombs explode and other
enemies take a kick, so each reacts as it does in SM64: Goombas are defeated,
Bullies are knocked back and can be shot again. Without a lock, shots go straight ahead and hit the nearest enemy in
the gun's spread.

| Gun | Damage | Range | Clip | Fire |
| --- | --- | --- | --- | --- |
| Pistol | 25 | 35 m | 17 | semi-auto |
| Desert Eagle | 70 | 35 m | 7 | semi-auto |
| Shotgun | 6 × 15, less with distance | 20 m | 1 | hits every enemy in its cone |
| Micro SMG | 20 | 30 m | 50 | automatic |
| M4 | 30 | 45 m | 50 | automatic |
| Sniper Rifle | 125 | 100 m | 1 | semi-auto |

Each gun has its own sound: the ROM has no gunfire, so shots are synthesized
from a filtered noise crack, a low thump and, for heavy guns, an echo. The
shotgun pumps and the sniper rifle works its bolt after firing, and there are
sounds for reloading, an empty trigger and switching guns. They follow the
game's mute button and pause with the rest of the audio.

The guns are GTA SA weapon types from gta-reversed's `eWeaponType`. Their
stats come from SA's `weapon.dat`, which isn't in gta-reversed, so the
values above are approximations tuned for this game (100 units ≈ 1 m).
