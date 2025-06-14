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
  "sfx/static1.mp3",
  "sfx/static2.mp3",
  "sfx/static3.mp3",
  "sfx/static4.mp3",
  "sfx/static5.mp3",
  "sfx/static6.mp3",
  "sfx/static7.mp3",
  "sfx/static8.mp3",
  "sfx/static9.mp3",
  "sfx/static10.mp3",
  "sfx/static11.mp3",
  "sfx/static12.mp3"
];

// Create a separate audio element for static sounds
const staticAudio = new Audio();

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
let isTransitioning = false;
let previousStationIndex = -1;

const audio = document.getElementById('audio-player');
const playButton = document.getElementById('playButton');
const container = document.querySelector('.container');
const logoContainer = document.createElement('div');
logoContainer.classList.add('station-carousel', 'hidden');
container.appendChild(logoContainer);

// Mask effect variables

// Initialize the station pages carousel
const initCarousel = () => {
  logoContainer.innerHTML = '';
  
  // Create a page for each station
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
  
  // Transform the container to show current station
  logoContainer.style.transform = `translateX(-${currentStation * 100}%)`;
};

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

// Variable to keep track of the current static sound index
let currentStaticIndex = 0;

// Get the next static sound file in order
const getStaticSound = () => {
  const soundFile = staticSounds[currentStaticIndex];
  currentStaticIndex = (currentStaticIndex + 1) % staticSounds.length; // Move to the next index, loop back if necessary
  return soundFile;
};

// Play a static transition sound
const playStaticTransition = () => {
  // Create a new Audio object for each static sound
  const staticEffect = new Audio(getStaticSound());
  staticEffect.volume = 1.0;

  // Play the static sound
  const staticPlayPromise = staticEffect.play();
  if (staticPlayPromise) {
    staticPlayPromise.catch(error => {
      console.error('Static sound play error:', error);
    });
  }

  // The static sound will play independently and be garbage collected
  // when it finishes. No need for onended handler here.
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
    
    // Set action handlers for media session
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
  isTransitioning = true; // Set transition flag

  const now = Date.now();
  const newStation = stations[currentStation];

  // Pause and store current time of previous station
  if (lastSwitchTime !== null && previousStationIndex !== -1) {
    const prevStation = stations[previousStationIndex];
    if (prevStation) {
      const elapsed = (now - lastSwitchTime) / 1000;
      prevStation.lastKnownTime += elapsed;
      prevStation.lastKnownTime %= prevStation.duration || Infinity;
      console.log(`[SWITCH] Station ${previousStationIndex} (${prevStation.name}) paused at ${prevStation.lastKnownTime.toFixed(2)}s`);
    }
  }

  // Update carousel position
  updateCarouselPosition();
  
  // Update Media Session for lock screen (update immediately for responsiveness)
  updateMediaSession(newStation);


  // Update switch time
  lastSwitchTime = now;
  
  // Define the delay before muting the previous station (in milliseconds)
  const staticMuteDelay = 50;

  // Define the delay before the next station starts (in milliseconds)
  const staticUnmuteDelay = 50; // Keep the previous unmute delay

  // Save current volume
  const originalVolume = audio.volume;

  // Set a timeout to mute the previous station
  setTimeout(() => {
    audio.pause();
    audio.volume = 0; // Ensure no residual sound
  }, staticMuteDelay);

  // Create and play static transition sound immediately
  const staticEffect = new Audio(getStaticSound());
  staticEffect.volume = 1.0;

  // Use loadedmetadata to get the duration of the static sound
  staticEffect.addEventListener('loadedmetadata', () => {
    const staticDurationMs = staticEffect.duration * 1000;
    const delayBeforeUnmute = Math.max(0, staticDurationMs - staticUnmuteDelay);

    // Set a timeout to prepare and play the next station
    setTimeout(prepareAndPlayNextStation, delayBeforeUnmute);
  });

  // Fallback if loadedmetadata doesn't fire (e.g., audio loading error)
  staticEffect.addEventListener('error', () => {
    console.error('Error loading static sound metadata or playing.');
    // Proceed with station transition after a short delay
    setTimeout(prepareAndPlayNextStation, 100);
  });

  const staticPlayPromise = staticEffect.play();
  if (staticPlayPromise) {
    staticPlayPromise.catch(error => {
      console.error('Static sound play error:', error);
      // If static sound fails to play, proceed with station transition after a short delay
      setTimeout(prepareAndPlayNextStation, 100);
    });
  }


  function prepareAndPlayNextStation() {
    // Prepare the next station
    const station = stations[currentStation];
    
    // Calculate current playback time
    const nowAfterTransition = Date.now();
    // Recalculate elapsed time from the original start time of the station
    const elapsed = (nowAfterTransition - station.startTime) / 1000;
    const playTime = station.duration ? (station.initialOffset + elapsed) % station.duration : 0;
    
    // Set source and time on main audio
    audio.src = station.file;
    audio.currentTime = playTime;
    audio.loop = true;
    audio.volume = originalVolume; // Restore original volume
    
    // Play the station
    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch(error => {
        console.error('Station play error:', error);
        // Quick retry
        setTimeout(() => audio.play(), 50);
      });
    }
    
    console.log(`[TRANSITION] Playing station ${currentStation} (${station.name}) at ${playTime.toFixed(2)}s`);
    
    // Preload adjacent stations
    preloadAdjacentStations();

    // Reset state
    isTransitioning = false;
  }
};

// Preload the next station in the sequence
// Preload the next and previous stations
const preloadAdjacentStations = () => {
  const nextStationIndex = (currentStation + 1) % stations.length;
  const prevStationIndex = (currentStation - 1 + stations.length) % stations.length;
  
  const nextStation = stations[nextStationIndex];
  const prevStation = stations[prevStationIndex];

  // Preload next station
  const tempAudioNext = new Audio();
  tempAudioNext.src = nextStation.file;
  tempAudioNext.preload = 'auto'; // Start loading the audio data
  console.log(`[PRELOAD] Started preloading for next station ${nextStationIndex} (${nextStation.name})`);

  // Preload previous station
  const tempAudioPrev = new Audio();
  tempAudioPrev.src = prevStation.file;
  tempAudioPrev.preload = 'auto'; // Start loading the audio data
  console.log(`[PRELOAD] Started preloading for previous station ${prevStationIndex} (${prevStation.name})`);
  
  // We don't need to keep references to tempAudioNext or tempAudioPrev,
  // the browser's media engine should handle the loading.
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
};

// Play button click
playButton.addEventListener('click', () => {
  playButton.style.display = 'none';
  logoContainer.classList.remove('hidden');
  
  // Initialize the carousel and mask
  initCarousel();
  initialPlay();
});

// Handle end of track for iOS loop issue
audio.addEventListener('ended', () => {
  console.log('Track ended, restarting...');
  audio.currentTime = 0;
  audio.play();
});

// Swipe support for mobile paging
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
  
  // Calculate horizontal and vertical movement
  const deltaX = startX - currentX;
  const deltaY = Math.abs(startY - currentY);
  
  // If horizontal movement is greater than vertical, it's likely a swipe
  if (Math.abs(deltaX) > deltaY && Math.abs(deltaX) > 5) {
    e.preventDefault(); // Prevent default to avoid scrolling
  }
});

container.addEventListener('touchend', e => {
  if (!initialTouch || isTransitioning) return;
  initialTouch = false;
  
  const endX = e.changedTouches[0].clientX;
  const deltaX = startX - endX;
  
  // Check if swipe was long enough to change station
  if (Math.abs(deltaX) > 50) {
    if (deltaX > 0) {
      // Swipe left - next station
      currentStation = (currentStation + 1) % stations.length;
    } else {
      // Swipe right - previous station
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
