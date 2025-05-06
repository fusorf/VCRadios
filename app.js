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
      currentStation = (currentStation - 1 + stations.length) % stations.length;
      updateStation();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      currentStation = (currentStation + 1) % stations.length;
      updateStation();
    });
  }
};

// Update logo + resume audio
const updateStation = () => {
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

  // Calculate current playback time
  const elapsed = (now - newStation.startTime) / 1000;
  const playTime = newStation.duration ? (newStation.initialOffset + elapsed) % newStation.duration : 0;
  newStation.lastKnownTime = playTime;

  // Update carousel position
  updateCarouselPosition();
  
  // Update Media Session for lock screen
  updateMediaSession(newStation);

  // Play audio
  audio.src = newStation.file;
  audio.currentTime = playTime;
  
  // Fix iOS loop issue
  audio.loop = true;
  
  // Play audio
  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.catch(error => {
      console.error('Playback error:', error);
      // Auto retry play
      setTimeout(() => audio.play(), 1000);
    });
  }
  
  console.log(`[PLAY] Station ${currentStation} (${newStation.name}) resumes at ${playTime.toFixed(2)}s`);

  // Trigger mask animation
  animateMaskEffect();

  // Update switch time
  lastSwitchTime = now;
};

// Play button click
playButton.addEventListener('click', () => {
  playButton.style.display = 'none';
  logoContainer.classList.remove('hidden');
  
  // Initialize the carousel and mask
  initCarousel();
  maskPoints = generateMaskPoints();
  createMaskOverlay();
  
  updateStation();
  animateMaskEffect();
});

// Handle end of track for iOS loop issue
audio.addEventListener('ended', () => {
  console.log('Track ended, restarting...');
  const station = stations[currentStation];
  audio.currentTime = 0;
  audio.play();
});

// Swipe support for mobile paging
let startX = null;
let startY = null;
let initialTouch = false;

container.addEventListener('touchstart', e => {
  startX = e.touches[0].clientX;
  startY = e.touches[0].clientY;
  initialTouch = true;
});

container.addEventListener('touchmove', e => {
  if (!initialTouch) return;
  
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
  if (!initialTouch) return;
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
  if (logoContainer.classList.contains('hidden')) return;
  
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