// Passed directly to page.evaluate: keep this function self-contained.
export function syntheticImages() {
  const make = (color, width, height, features = false) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, width, height);
    context.fillStyle = '#000'; context.fillText('SYNTHETIC', 4, 18);
    if (features) for (const [fraction, color] of [[0.3, '#d43c35'], [0.5, '#23864b'], [0.7, '#315bd4']]) {
      context.fillStyle = color; context.fillRect(width * fraction - 20, height * fraction - 15, 40, 30);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  };
  return {photo: make('#c7e5dd', 240, 160), map: make('#eee5ca', 320, 200, true)};
}
