// The game needs assets from two games the player owns: the Super Mario 64 ROM
// and the GTA San Andreas PS2 disc. Start unlocks once both are loaded.
const met = { rom: false, gta: false }

export const allRequirementsMet = () => met.rom && met.gta

export const requirementMet = name => {
    met[name] = true
    const button = document.getElementById('startbutton')
    if (button) button.disabled = !allRequirementsMet()
}
