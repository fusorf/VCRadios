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

const audio = document.getElementById('audio-player');
const playButton = document.getElementById('playButton');
const container = document.querySelector('.container');
const logoContainer = document.createElement('div');
logoContainer.classList.add('station-carousel', 'hidden');
container.appendChild(logoContainer);

// Mask effect variables
let maskPoints = [];
let animatingMask = false;

// Create SVG mask overlay
const createMaskOverlay = () => {
  // Remove existing mask if any
  const existingMask = document.querySelector('.mask-overlay');
  if (existingMask) existingMask.remove();
  
  // Create SVG element with proper namespace
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, 'svg');
  svg.classList.add('mask-overlay');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  
  // Create a backdrop rectangle (black background)
  const backdrop = document.createElementNS(svgNS, 'rect');
  backdrop.id = 'overlay-backdrop';
  backdrop.setAttribute('width', '100%');
  backdrop.setAttribute('height', '100%');
  backdrop.setAttribute('fill', 'rgba(0, 0, 0, 0)'); // Transparent fill that should be black
  svg.appendChild(backdrop);
  
  // Create the polygon that will cut through the backdrop
  const polygon = document.createElementNS(svgNS, 'polygon');
  polygon.classList.add('mask-polygon');
  
  // Add the polygon to the SVG
  svg.appendChild(polygon);
  
  // Add the SVG to the document
  document.body.appendChild(svg);
  
  return polygon;
};

// Generate random points for mask (one in each quadrant)
const generateMaskPoints = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const midX = width / 2;
  const midY = height / 2;
  
  // Generate a point in each quadrant
  return [
    // Top-left
    {
      x: Math.random() * midX * 0.8 + midX * 0.1,
      y: Math.random() * midY * 0.8 + midY * 0.1
    },
    // Top-right
    {
      x: Math.random() * midX * 0.8 + midX * 1.1,
      y: Math.random() * midY * 0.8 + midY * 0.1
    },
    // Bottom-right
    {
      x: Math.random() * midX * 0.8 + midX * 1.1,
      y: Math.random() * midY * 0.8 + midY * 1.1
    },
    // Bottom-left
    {
      x: Math.random() * midX * 0.8 + midX * 0.1,
      y: Math.random() * midY * 0.8 + midY * 1.1
    }
  ];
};

// Animate mask effect
const animateMaskEffect = () => {
  if (animatingMask) return;
  animatingMask = true;
  
  const startPoints = maskPoints.length ? [...maskPoints] : generateMaskPoints();
  const targetPoints = generateMaskPoints();
  const polygon = createMaskOverlay();
  
  // Set initial polygon points
  let pointsStr = startPoints.map(p => `${p.x},${p.y}`).join(' ');
  polygon.setAttribute('points', pointsStr);
  
  // Animate to new points
  const startTime = Date.now();
  const duration = 400; // Animation duration in ms - much faster (was 1000ms)
  
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    
    // Calculate current points based on progress
    const currentPoints = startPoints.map((startP, i) => {
      const targetP = targetPoints[i];
      return {
        x: startP.x + (targetP.x - startP.x) * progress,
        y: startP.y + (targetP.y - startP.y) * progress
      };
    });
    
    // Update polygon
    pointsStr = currentPoints.map(p => `${p.x},${p.y}`).join(' ');
    polygon.setAttribute('points', pointsStr);
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    } else {
      maskPoints = targetPoints;
      animatingMask = false;
    }
  };
  
  animate();
};

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
const getRandomStaticSound = () => {
  const soundFile = staticSounds[currentStaticIndex];
  currentStaticIndex = (currentStaticIndex + 1) % staticSounds.length; // Move to the next index, loop back if necessary
  return soundFile;
};

// Play a static transition sound
const playStaticTransition = () => {
  // Create a new Audio object for each static sound
  const staticEffect = new Audio(getRandomStaticSound());
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
  if (lastSwitchTime !== null) {
    const prevStation = stations.find((s, i) => i !== currentStation && s.startTime !== null);
    if (prevStation) {
      const elapsed = (now - lastSwitchTime) / 1000;
      prevStation.lastKnownTime += elapsed;
      prevStation.lastKnownTime %= prevStation.duration || Infinity;
      console.log(`[SWITCH] Station ${stations.indexOf(prevStation)} (${prevStation.name}) paused at ${prevStation.lastKnownTime.toFixed(2)}s`);
    }
  }

  // Update carousel position
  updateCarouselPosition();
  
  // Update Media Session for lock screen (update immediately for responsiveness)
  updateMediaSession(newStation);

  // Trigger mask animation
  animateMaskEffect();

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
  const staticEffect = new Audio(getRandomStaticSound());
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
};

// Play button click
playButton.addEventListener('click', () => {
  playButton.style.display = 'none';
  logoContainer.classList.remove('hidden');
  
  // Initialize the carousel and mask
  initCarousel();
  maskPoints = generateMaskPoints();
  createMaskOverlay();
  
  initialPlay();
  animateMaskEffect();
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
    currentStation = (currentStation + 1) % stations.length;
    updateStation();
  } else if (e.key === 'ArrowLeft') {
    currentStation = (currentStation - 1 + stations.length) % stations.length;
    updateStation();
  }
});

// Handle window resize to update mask
window.addEventListener('resize', () => {
  if (!logoContainer.classList.contains('hidden')) {
    maskPoints = generateMaskPoints();
    const polygon = document.querySelector('.mask-polygon');
    if (polygon) {
      const pointsStr = maskPoints.map(p => `${p.x},${p.y}`).join(' ');
      polygon.setAttribute('points', pointsStr);
    }
  }
});