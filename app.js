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

// Static transition sounds
const staticSounds = [
  "sfx/static1.mp3", "sfx/static2.mp3", "sfx/static3.mp3", "sfx/static4.mp3",
  "sfx/static5.mp3", "sfx/static6.mp3", "sfx/static7.mp3", "sfx/static8.mp3",
  "sfx/static9.mp3", "sfx/static10.mp3", "sfx/static11.mp3", "sfx/static12.mp3"
];

// Initialize all stations with start time NOW
const appStartTime = Date.now();

// Add runtime data to each station
stations.forEach(s => {
  s.startTime = appStartTime;
  s.initialOffset = 0;
  s.duration = null;
  s.lastKnownTime = 0;
  s._durationKnown = false;
  s._preloading = false;
  s._preloaded = false;
});

// DOM references
let currentStation = 0;
let lastSwitchTime = null;
let isTransitioning = false;
let previousStationIndex = -1;

const audio = document.getElementById('audio-player');
const playButton = document.getElementById('playButton');
const container = document.querySelector('.container');
const logoContainer = document.createElement('div');
logoContainer.classList.add('station-carousel', 'hidden');
container.appendChild(logoContainer);

// iOS PWA audio unlock flag
let audioUnlocked = false;

// Detect if running as PWA on iOS
const isIOSPWA = () => {
  return (
    window.navigator.standalone === true || // iOS Safari PWA
    window.matchMedia('(display-mode: standalone)').matches // General PWA
  );
};

// Preload strategy: load metadata for all, then progressively cache audio files
const preloadDurations = () => {
  stations.forEach((station, index) => {
    // For iOS PWA, preload metadata more aggressively
    const tempAudio = new Audio();
    tempAudio.src = station.file;
    tempAudio.preload = isIOSPWA() ? 'auto' : 'metadata';
    
    tempAudio.addEventListener('loadedmetadata', () => {
      station.duration = tempAudio.duration;
      station.initialOffset = Math.random() * station.duration;
      station._durationKnown = true;
      console.log(`[METADATA] Station ${index} (${station.name}): ${station.duration.toFixed(2)}s`);
    });
    
    // iOS PWA fallback: if metadata doesn't load, use a default duration
    setTimeout(() => {
      if (!station._durationKnown) {
        console.warn(`[METADATA] Station ${index} metadata timeout, using default`);
        station.duration = 3600; // 1 hour default
        station.initialOffset = Math.random() * station.duration;
        station._durationKnown = true;
      }
    }, 5000);
  });
};

// Progressive station preloading via Service Worker
const progressivePreload = () => {
  if (!('serviceWorker' in navigator)) return;
  
  // Preload current station first
  preloadStationInBackground(currentStation);
  
  // Then preload adjacent stations
  setTimeout(() => {
    const next = (currentStation + 1) % stations.length;
    const prev = (currentStation - 1 + stations.length) % stations.length;
    preloadStationInBackground(next);
    preloadStationInBackground(prev);
  }, 2000);
  
  // Finally, preload remaining stations in the background over time
  setTimeout(() => {
    stations.forEach((station, index) => {
      if (!station._preloaded && index !== currentStation) {
        setTimeout(() => preloadStationInBackground(index), index * 5000);
      }
    });
  }, 10000);
};

const preloadStationInBackground = (stationIndex) => {
  const station = stations[stationIndex];
  if (station._preloading || station._preloaded) return;
  
  station._preloading = true;
  console.log(`[PRELOAD] Background caching station ${stationIndex} (${station.name})`);
  
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({
      type: 'PRELOAD_STATION',
      url: station.file
    });
  }
  
  // Also trigger browser preload
  const preloadLink = document.createElement('link');
  preloadLink.rel = 'prefetch';
  preloadLink.href = station.file;
  preloadLink.as = 'audio';
  document.head.appendChild(preloadLink);
  
  station._preloaded = true;
  station._preloading = false;
};

preloadDurations();

// Initialize the station pages carousel
const initCarousel = () => {
  logoContainer.innerHTML = '';
  
  stations.forEach((station, index) => {
    const page = document.createElement('div');
    page.classList.add('station-page');
    page.dataset.index = index;
    
    const img = document.createElement('img');
    img.src = station.logo;
    img.alt = station.name;
    
    page.appendChild(img);
    logoContainer.appendChild(page);
  });
  
  updateCarouselPosition();
};

// Update carousel position to show current station
const updateCarouselPosition = () => {
  const pages = document.querySelectorAll('.station-page');
  pages.forEach(page => {
    const index = parseInt(page.dataset.index);
    page.classList.toggle('active', index === currentStation);
  });
  
  logoContainer.style.transform = `translateX(-${currentStation * 100}%)`;
};

// Variable to keep track of the current static sound index
let currentStaticIndex = 0;

// Get the next static sound file in order
const getStaticSound = () => {
  const soundFile = staticSounds[currentStaticIndex];
  currentStaticIndex = (currentStaticIndex + 1) % staticSounds.length;
  return soundFile;
};

// Update lock screen media session
const updateMediaSession = (station) => {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: station.name,
      artist: 'Vice City Radio',
      album: 'GTA Vice City',
      artwork: [
        { src: station.logo, sizes: '512x512', type: 'image/webp' }
      ]
    });
    
    navigator.mediaSession.setActionHandler('play', () => {
      audio.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audio.pause();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (isTransitioning) return;
      currentStation = (currentStation - 1 + stations.length) % stations.length;
      updateStation();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (isTransitioning) return;
      currentStation = (currentStation + 1) % stations.length;
      updateStation();
    });
  }
};

// Update station with transition effect
const updateStation = () => {
  if (isTransitioning) return;
  isTransitioning = true;

  const now = Date.now();
  const newStation = stations[currentStation];

  // Pause and store current time of previous station
  if (lastSwitchTime !== null && previousStationIndex !== -1) {
    const prevStation = stations[previousStationIndex];
    if (prevStation) {
      const elapsed = (now - lastSwitchTime) / 1000;
      prevStation.lastKnownTime += elapsed;
      prevStation.lastKnownTime %= prevStation.duration || Infinity;
    }
  }

  // Update carousel position
  updateCarouselPosition();
  
  // Update Media Session for lock screen
  updateMediaSession(newStation);

  // Update switch time
  lastSwitchTime = now;
  
  const staticMuteDelay = 50;
  const staticUnmuteDelay = 50;

  // Save current volume
  const originalVolume = audio.volume;

  // Mute previous station
  setTimeout(() => {
    audio.pause();
    audio.volume = 0;
  }, staticMuteDelay);

  // Create and play static transition sound
  const staticEffect = new Audio(getStaticSound());
  staticEffect.volume = 1.0;
  
  // iOS PWA: load before playing
  if (isIOSPWA()) {
    staticEffect.load();
  }

  staticEffect.addEventListener('loadedmetadata', () => {
    const staticDurationMs = staticEffect.duration * 1000;
    const delayBeforeUnmute = Math.max(0, staticDurationMs - staticUnmuteDelay);
    setTimeout(prepareAndPlayNextStation, delayBeforeUnmute);
  });

  staticEffect.addEventListener('error', () => {
    console.error('Error loading static sound metadata or playing.');
    setTimeout(prepareAndPlayNextStation, 100);
  });

  const staticPlayPromise = staticEffect.play();
  if (staticPlayPromise) {
    staticPlayPromise.catch(error => {
      console.error('Static sound play error:', error);
      // Don't let static sound failure prevent station switch
      setTimeout(prepareAndPlayNextStation, 100);
    });
  } else {
    // Fallback if play() returns undefined (older browsers)
    setTimeout(prepareAndPlayNextStation, 100);
  }

  function prepareAndPlayNextStation() {
    const station = stations[currentStation];
    
    // Calculate current playback time
    const nowAfterTransition = Date.now();
    const elapsed = (nowAfterTransition - station.startTime) / 1000;
    const playTime = station.duration ? (station.initialOffset + elapsed) % station.duration : 0;
    
    // For iOS PWA: set source first, then load, then set time
    audio.src = station.file;
    audio.loop = true;
    audio.volume = originalVolume;
    
    // Load the audio before trying to set currentTime
    audio.load();
    
    // Set time after load starts (iOS needs this)
    if (station.duration && playTime > 0) {
      audio.currentTime = playTime;
    }
    
    // Play the station with better error handling for iOS PWA
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        console.log(`[TRANSITION] Playing station ${currentStation} (${station.name}) at ${playTime.toFixed(2)}s`);
      }).catch(error => {
        console.error('Station play error:', error);
        // iOS PWA retry strategy
        audio.load();
        setTimeout(() => {
          audio.play().catch(e => console.error('Retry failed:', e));
        }, 50);
      });
    }

    // Preload adjacent stations for next switch
    const next = (currentStation + 1) % stations.length;
    const prev = (currentStation - 1 + stations.length) % stations.length;
    preloadStationInBackground(next);
    preloadStationInBackground(prev);

    // Reset state
    isTransitioning = false;
  }
};

// Initial play without static transition
const initialPlay = () => {
  const now = Date.now();
  const station = stations[currentStation];
  
  // Calculate playback start time
  const elapsed = (now - station.startTime) / 1000;
  const playTime = station.duration ? (station.initialOffset + elapsed) % station.duration : 0;
  
  // Update Media Session
  updateMediaSession(station);
  
  // Set up audio
  audio.src = station.file;
  audio.currentTime = playTime;
  audio.loop = true;
  
  // Play audio
  const playPromise = audio.play();
  if (playPromise) {
    playPromise.catch(error => {
      console.error('Initial play error:', error);
      setTimeout(() => audio.play(), 100);
    });
  }
  
  // Update switch time
  lastSwitchTime = now;
  
  console.log(`[INITIAL] Playing station ${currentStation} (${station.name}) at ${playTime.toFixed(2)}s`);
  
  // Start progressive preloading after initial play
  progressivePreload();
};

// Play button click - iOS PWA needs immediate audio interaction
playButton.addEventListener('click', async () => {
  // CRITICAL: For iOS PWA, we must call play() synchronously in the click handler
  // Create a silent audio context first to unlock audio in iOS PWA
  try {
    // Try to play a tiny bit of silence to unlock audio API
    const silentAudio = new Audio();
    silentAudio.src = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAADhAC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAA4T0Xr8YAAAAAAAAAAAAAAAAAAAA//sQZAAP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAETEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQZDgP8AAAaQAAAAgAAA0gAAABAAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV';
    silentAudio.volume = 0;
    await silentAudio.play();
  } catch (e) {
    console.log('[IOS PWA] Silent audio unlock attempt:', e);
  }
  
  playButton.style.display = 'none';
  logoContainer.classList.remove('hidden');
  
  initCarousel();
  
  // Initialize audio element immediately in the click handler
  const station = stations[currentStation];
  audio.src = station.file;
  audio.loop = true;
  
  // For iOS PWA: must call load() and play() in the same click handler
  audio.load();
  
  // Start playing immediately (required for iOS PWA)
  audio.play().then(() => {
    console.log('[IOS PWA] Audio unlocked successfully');
    // Now we can set the proper time
    const now = Date.now();
    const elapsed = (now - station.startTime) / 1000;
    const playTime = station.duration ? (station.initialOffset + elapsed) % station.duration : 0;
    
    if (station.duration && playTime > 0) {
      audio.currentTime = playTime;
    }
    
    lastSwitchTime = now;
    updateMediaSession(station);
    
    console.log(`[INITIAL] Playing station ${currentStation} (${station.name}) at ${playTime.toFixed(2)}s`);
    
    // Start progressive preloading after initial play
    progressivePreload();
  }).catch(error => {
    console.error('[IOS PWA] Play failed:', error);
    // Retry with a simpler approach
    setTimeout(() => {
      audio.play().catch(e => console.error('[IOS PWA] Retry failed:', e));
    }, 100);
  });
});

// Handle end of track for iOS loop issue
audio.addEventListener('ended', () => {
  console.log('Track ended, restarting...');
  audio.currentTime = 0;
  audio.play();
});

// Swipe support for mobile
let startX = null;
let startY = null;
let initialTouch = false;

container.addEventListener('touchstart', e => {
  if (isTransitioning) return;
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
  initialTouch = true;
});

container.addEventListener('touchmove', e => {
  if (!initialTouch || isTransitioning) return;
  
  const currentX = e.touches[0].clientX;
  const currentY = e.touches[0].clientY;
  
  const deltaX = startX - currentX;
  const deltaY = Math.abs(startY - currentY);
  
  if (Math.abs(deltaX) > deltaY && Math.abs(deltaX) > 5) {
    e.preventDefault();
  }
});

container.addEventListener('touchend', e => {
  if (!initialTouch || isTransitioning) return;
  initialTouch = false;
  
  const endX = e.changedTouches[0].clientX;
  const deltaX = startX - endX;
  
  if (Math.abs(deltaX) > 50) {
    if (deltaX > 0) {
      currentStation = (currentStation + 1) % stations.length;
    } else {
      currentStation = (currentStation - 1 + stations.length) % stations.length;
    }
    updateStation();
  }
  
  startX = null;
  startY = null;
});

// Keyboard nav
document.addEventListener('keydown', e => {
  if (logoContainer.classList.contains('hidden') || isTransitioning) return;
  
  if (e.key === 'ArrowRight') {
    previousStationIndex = currentStation;
    currentStation = (currentStation + 1) % stations.length;
    updateStation();
  } else if (e.key === 'ArrowLeft') {
    previousStationIndex = currentStation;
    currentStation = (currentStation - 1 + stations.length) % stations.length;
    updateStation();
  }
});