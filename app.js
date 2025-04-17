const stations = [
    { name: "Emotion 98.3", file: "radio/EMOTION.mp3", logo: "logos/Emotion98.3-GTAVC-Logo.webp" },
    { name: "Radio Espantoso", file: "radio/ESPANT.mp3", logo: "logos/RadioEspantoso-GTAVC-Logo.webp" },
    { name: "Fever 105", file: "radio/FEVER.mp3", logo: "logos/Fever_105.webp" },
    { name: "Flash FM", file: "radio/FLASH.mp3", logo: "logos/FlashFM.webp" },
    { name: "K-Chat", file: "radio/KCHAT.mp3", logo: "logos/KChat-GTAVC-Logo.webp" },
    { name: "VCPR", file: "radio/VCPR.mp3", logo: "logos/ViceCityPublicRadio-GTAVC-Logo.svg" },
    { name: "V-Rock", file: "radio/VROCK.mp3", logo: "logos/V-Rock-GTAVC-Logo.svg" },
    { name: "Wave 103", file: "radio/WAVE.mp3", logo: "logos/Wave103-GTAVC-Logo.svg" },
    { name: "Wildstyle", file: "radio/WILD.mp3", logo: "logos/WildstylePirateRadio.webp" }
  ];
  
  // Add runtime data to each station
  stations.forEach(s => {
    s.startTime = null;
    s.initialOffset = 0;
    s.duration = null;
    s.lastKnownTime = 0;
    s._durationKnown = false;
  });
  
  // DOM references
  let currentStation = 0;
  let lastSwitchTime = null;
  
  const audio = document.getElementById('audio-player');
  const playButton = document.getElementById('playButton');
  const container = document.querySelector('.container');
  const logoContainer = document.createElement('div');
  logoContainer.classList.add('carousel', 'hidden');
  container.appendChild(logoContainer);
  
  // Preload durations and random offsets
  const preloadDurations = () => {
    stations.forEach((station, index) => {
      const tempAudio = new Audio();
      tempAudio.src = station.file;
      tempAudio.preload = 'metadata';
      tempAudio.addEventListener('loadedmetadata', () => {
        station.duration = tempAudio.duration;
        station.initialOffset = Math.random() * station.duration;
        station._durationKnown = true;
        station.startTime = Date.now();
        console.log(`[PRELOAD] Station ${index} (${station.name}) duration: ${station.duration.toFixed(2)}s → start at ${station.initialOffset.toFixed(2)}s`);
      });
    });
  };
  preloadDurations();
  
  // Update logo + resume audio
  const updateLogo = () => {
    const now = Date.now();
    const newStation = stations[currentStation];
  
    // Pause and store current time of previous station
    if (lastSwitchTime !== null) {
      const prevStation = stations.find((s, i) => i !== currentStation && s.startTime !== null);
      if (prevStation) {
        const elapsed = (now - lastSwitchTime) / 1000;
        prevStation.lastKnownTime += elapsed;
        prevStation.lastKnownTime %= prevStation.duration;
        console.log(`[SWITCH] Station ${stations.indexOf(prevStation)} (${prevStation.name}) paused at ${prevStation.lastKnownTime.toFixed(2)}s`);
      }
    }
  
    // Calculate current playback time
    const elapsed = (now - newStation.startTime) / 1000;
    const playTime = (newStation.initialOffset + elapsed) % newStation.duration;
    newStation.lastKnownTime = playTime;
  
    // Update UI
    logoContainer.innerHTML = '';
    const img = document.createElement('img');
    img.src = newStation.logo;
    img.alt = newStation.name;
    img.classList.add('active');
    logoContainer.appendChild(img);
  
    // Play audio
    audio.src = newStation.file;
    audio.currentTime = playTime;
    audio.play();
    console.log(`[PLAY] Station ${currentStation} (${newStation.name}) resumes at ${playTime.toFixed(2)}s`);
  
    // Update switch time
    lastSwitchTime = now;
  };
  
  // Play button click
  playButton.addEventListener('click', () => {
    playButton.style.display = 'none';
    logoContainer.classList.remove('hidden');
    updateLogo();
  });
  
  // Swipe support
  let startX = null;
  logoContainer.addEventListener('touchstart', e => startX = e.touches[0].clientX);
  logoContainer.addEventListener('touchend', e => {
    if (startX === null) return;
    const deltaX = e.changedTouches[0].clientX - startX;
    if (Math.abs(deltaX) > 50) {
      if (deltaX > 0) currentStation = (currentStation - 1 + stations.length) % stations.length;
      else currentStation = (currentStation + 1) % stations.length;
      updateLogo();
    }
    startX = null;
  });
  
  // Keyboard nav
  document.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') {
      currentStation = (currentStation + 1) % stations.length;
      updateLogo();
    } else if (e.key === 'ArrowLeft') {
      currentStation = (currentStation - 1 + stations.length) % stations.length;
      updateLogo();
    }
  });
  
