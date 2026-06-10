/**
 * EmojiPicker — V2 G2 (2026-05-21).
 *
 * Picker emoji categorized không phụ thuộc thư viện ngoài (tránh kéo 250KB
 * emoji-mart). ~270 emoji phân thành 9 category, search lowercase + native
 * tab nav dưới đáy.
 *
 * Usage:
 *   <EmojiPicker onSelect={(e) => insert(e)} onClose={() => setOpen(false)} />
 *
 * Render trong Popover hoặc absolute floating div của caller. Component
 * tự handle keyboard navigation + search filter.
 *
 * Spec: docs/plans/study-group-v2.md §G2 + §7.3.
 */
'use client';

import * as React from 'react';
import { Search, X } from 'lucide-react';

import { cn } from '@/lib/utils';

type Category = {
  id: string;
  /** Tab icon emoji */
  icon: string;
  label: string;
  /** Search keyword (lowercase, có thể nhiều keyword join space) cho emoji. */
  emojis: { e: string; k: string }[];
};

const CATEGORIES: Category[] = [
  {
    id: 'smileys',
    icon: '😀',
    label: 'Smileys',
    emojis: [
      { e: '😀', k: 'grinning face' },
      { e: '😃', k: 'smiley happy' },
      { e: '😄', k: 'smile happy' },
      { e: '😁', k: 'beaming grin' },
      { e: '😆', k: 'laugh' },
      { e: '😅', k: 'sweat smile' },
      { e: '🤣', k: 'rofl laughing' },
      { e: '😂', k: 'joy tears' },
      { e: '🙂', k: 'slight smile' },
      { e: '🙃', k: 'upside down' },
      { e: '😉', k: 'wink' },
      { e: '😊', k: 'blush smile' },
      { e: '😇', k: 'innocent halo' },
      { e: '🥰', k: 'love smile' },
      { e: '😍', k: 'heart eyes' },
      { e: '🤩', k: 'star struck' },
      { e: '😘', k: 'kiss' },
      { e: '😗', k: 'kissing' },
      { e: '😚', k: 'kissing closed' },
      { e: '😙', k: 'kissing smiling' },
      { e: '🥲', k: 'smiling tear' },
      { e: '😋', k: 'yum' },
      { e: '😛', k: 'tongue' },
      { e: '😜', k: 'wink tongue' },
      { e: '🤪', k: 'zany' },
      { e: '😝', k: 'squinting tongue' },
      { e: '🤑', k: 'money mouth' },
      { e: '🤗', k: 'hug' },
      { e: '🤭', k: 'hand mouth' },
      { e: '🤫', k: 'shush quiet' },
      { e: '🤔', k: 'thinking' },
      { e: '🤐', k: 'zip mouth' },
      { e: '🤨', k: 'raised brow' },
      { e: '😐', k: 'neutral' },
      { e: '😑', k: 'expressionless' },
      { e: '😶', k: 'no mouth' },
      { e: '😏', k: 'smirk' },
      { e: '😒', k: 'unamused' },
      { e: '🙄', k: 'eye roll' },
      { e: '😬', k: 'grimace' },
      { e: '🤥', k: 'lying' },
      { e: '😌', k: 'relieved' },
      { e: '😔', k: 'pensive' },
      { e: '😪', k: 'sleepy' },
      { e: '😴', k: 'sleep' },
      { e: '😷', k: 'mask sick' },
      { e: '🤒', k: 'thermometer' },
      { e: '🤕', k: 'bandage' },
      { e: '🤢', k: 'nauseated' },
      { e: '🤮', k: 'vomit' },
      { e: '🥵', k: 'hot' },
      { e: '🥶', k: 'cold freeze' },
      { e: '🥴', k: 'woozy' },
      { e: '😵', k: 'dizzy' },
      { e: '🤯', k: 'mind blown' },
      { e: '🤠', k: 'cowboy' },
      { e: '🥳', k: 'party' },
      { e: '😎', k: 'cool sunglasses' },
      { e: '🤓', k: 'nerd' },
      { e: '🧐', k: 'monocle' },
      { e: '😕', k: 'confused' },
      { e: '😟', k: 'worried' },
      { e: '🙁', k: 'slight frown' },
      { e: '☹️', k: 'frown' },
      { e: '😮', k: 'open mouth surprised' },
      { e: '😯', k: 'hushed' },
      { e: '😲', k: 'astonished' },
      { e: '😳', k: 'flushed' },
      { e: '🥺', k: 'pleading' },
      { e: '😦', k: 'frowning' },
      { e: '😧', k: 'anguished' },
      { e: '😨', k: 'fearful' },
      { e: '😰', k: 'anxious sweat' },
      { e: '😥', k: 'sad sweat' },
      { e: '😢', k: 'crying tear' },
      { e: '😭', k: 'sob crying' },
      { e: '😱', k: 'scream fear' },
      { e: '😖', k: 'confounded' },
      { e: '😣', k: 'persevering' },
      { e: '😞', k: 'disappointed' },
      { e: '😓', k: 'sweat' },
      { e: '😩', k: 'weary' },
      { e: '😫', k: 'tired' },
      { e: '🥱', k: 'yawn' },
      { e: '😤', k: 'huffing' },
      { e: '😡', k: 'angry red' },
      { e: '😠', k: 'angry' },
      { e: '🤬', k: 'cursing' },
      { e: '😈', k: 'smiling devil' },
      { e: '👿', k: 'angry devil' },
      { e: '💀', k: 'skull' },
      { e: '💩', k: 'poop' },
      { e: '🤡', k: 'clown' },
      { e: '👻', k: 'ghost' },
      { e: '👽', k: 'alien' },
      { e: '🤖', k: 'robot' },
    ],
  },
  {
    id: 'people',
    icon: '👋',
    label: 'People',
    emojis: [
      { e: '👋', k: 'wave hi hello' },
      { e: '🤚', k: 'raised back hand' },
      { e: '✋', k: 'raised hand stop' },
      { e: '🖖', k: 'vulcan' },
      { e: '👌', k: 'ok' },
      { e: '🤌', k: 'pinched fingers' },
      { e: '🤏', k: 'pinching' },
      { e: '✌️', k: 'peace victory' },
      { e: '🤞', k: 'crossed fingers' },
      { e: '🤟', k: 'love rock' },
      { e: '🤘', k: 'rock metal' },
      { e: '🤙', k: 'call me' },
      { e: '👈', k: 'point left' },
      { e: '👉', k: 'point right' },
      { e: '👆', k: 'point up' },
      { e: '👇', k: 'point down' },
      { e: '☝️', k: 'index up' },
      { e: '👍', k: 'thumbs up like ok' },
      { e: '👎', k: 'thumbs down dislike' },
      { e: '✊', k: 'fist' },
      { e: '👊', k: 'punch' },
      { e: '🤛', k: 'fist left' },
      { e: '🤜', k: 'fist right' },
      { e: '👏', k: 'clap applause' },
      { e: '🙌', k: 'raised hands praise' },
      { e: '👐', k: 'open hands' },
      { e: '🤲', k: 'palms up' },
      { e: '🤝', k: 'handshake' },
      { e: '🙏', k: 'pray thanks' },
      { e: '✍️', k: 'write hand' },
      { e: '💪', k: 'muscle strong' },
      { e: '🦾', k: 'mechanical arm' },
      { e: '🧠', k: 'brain' },
      { e: '👶', k: 'baby' },
      { e: '👧', k: 'girl' },
      { e: '🧒', k: 'child' },
      { e: '👦', k: 'boy' },
      { e: '👩', k: 'woman' },
      { e: '🧑', k: 'person' },
      { e: '👨', k: 'man' },
      { e: '👵', k: 'old woman' },
      { e: '🧓', k: 'older person' },
      { e: '👴', k: 'old man' },
      { e: '👮', k: 'police' },
      { e: '🕵️', k: 'detective' },
      { e: '👷', k: 'construction' },
      { e: '👸', k: 'princess' },
      { e: '🤴', k: 'prince' },
      { e: '👼', k: 'angel baby' },
      { e: '🎅', k: 'santa' },
    ],
  },
  {
    id: 'animals',
    icon: '🐶',
    label: 'Animals',
    emojis: [
      { e: '🐶', k: 'dog' },
      { e: '🐱', k: 'cat' },
      { e: '🐭', k: 'mouse' },
      { e: '🐹', k: 'hamster' },
      { e: '🐰', k: 'rabbit' },
      { e: '🦊', k: 'fox' },
      { e: '🐻', k: 'bear' },
      { e: '🐼', k: 'panda' },
      { e: '🐨', k: 'koala' },
      { e: '🐯', k: 'tiger' },
      { e: '🦁', k: 'lion' },
      { e: '🐮', k: 'cow' },
      { e: '🐷', k: 'pig' },
      { e: '🐸', k: 'frog' },
      { e: '🐵', k: 'monkey' },
      { e: '🙈', k: 'see no evil' },
      { e: '🙉', k: 'hear no evil' },
      { e: '🙊', k: 'speak no evil' },
      { e: '🐔', k: 'chicken' },
      { e: '🐧', k: 'penguin' },
      { e: '🐦', k: 'bird' },
      { e: '🐤', k: 'baby chick' },
      { e: '🦆', k: 'duck' },
      { e: '🦉', k: 'owl' },
      { e: '🐺', k: 'wolf' },
      { e: '🐗', k: 'boar' },
      { e: '🐴', k: 'horse' },
      { e: '🦄', k: 'unicorn' },
      { e: '🐝', k: 'bee' },
      { e: '🐛', k: 'bug' },
      { e: '🦋', k: 'butterfly' },
      { e: '🐌', k: 'snail' },
      { e: '🐞', k: 'ladybug' },
      { e: '🐢', k: 'turtle' },
      { e: '🐍', k: 'snake' },
      { e: '🦎', k: 'lizard' },
      { e: '🦖', k: 'trex dino' },
      { e: '🐙', k: 'octopus' },
      { e: '🦑', k: 'squid' },
      { e: '🦐', k: 'shrimp' },
      { e: '🦞', k: 'lobster' },
      { e: '🦀', k: 'crab' },
      { e: '🐡', k: 'pufferfish' },
      { e: '🐠', k: 'tropical fish' },
      { e: '🐟', k: 'fish' },
      { e: '🐳', k: 'whale' },
      { e: '🐬', k: 'dolphin' },
      { e: '🦈', k: 'shark' },
      { e: '🐘', k: 'elephant' },
      { e: '🦒', k: 'giraffe' },
      { e: '🦓', k: 'zebra' },
    ],
  },
  {
    id: 'food',
    icon: '🍕',
    label: 'Food',
    emojis: [
      { e: '🍏', k: 'green apple' },
      { e: '🍎', k: 'apple' },
      { e: '🍐', k: 'pear' },
      { e: '🍊', k: 'orange' },
      { e: '🍋', k: 'lemon' },
      { e: '🍌', k: 'banana' },
      { e: '🍉', k: 'watermelon' },
      { e: '🍇', k: 'grapes' },
      { e: '🍓', k: 'strawberry' },
      { e: '🫐', k: 'blueberry' },
      { e: '🍈', k: 'melon' },
      { e: '🍒', k: 'cherry' },
      { e: '🍑', k: 'peach' },
      { e: '🥭', k: 'mango' },
      { e: '🍍', k: 'pineapple' },
      { e: '🥥', k: 'coconut' },
      { e: '🥝', k: 'kiwi' },
      { e: '🍅', k: 'tomato' },
      { e: '🍆', k: 'eggplant' },
      { e: '🥑', k: 'avocado' },
      { e: '🥦', k: 'broccoli' },
      { e: '🥬', k: 'lettuce' },
      { e: '🌽', k: 'corn' },
      { e: '🥕', k: 'carrot' },
      { e: '🧄', k: 'garlic' },
      { e: '🧅', k: 'onion' },
      { e: '🥔', k: 'potato' },
      { e: '🍠', k: 'sweet potato' },
      { e: '🍞', k: 'bread' },
      { e: '🥐', k: 'croissant' },
      { e: '🥖', k: 'baguette' },
      { e: '🥯', k: 'bagel' },
      { e: '🧀', k: 'cheese' },
      { e: '🥚', k: 'egg' },
      { e: '🍳', k: 'fried egg' },
      { e: '🥞', k: 'pancake' },
      { e: '🧇', k: 'waffle' },
      { e: '🥓', k: 'bacon' },
      { e: '🥩', k: 'steak meat' },
      { e: '🍗', k: 'chicken leg' },
      { e: '🍔', k: 'burger' },
      { e: '🍟', k: 'fries' },
      { e: '🍕', k: 'pizza' },
      { e: '🌭', k: 'hotdog' },
      { e: '🌮', k: 'taco' },
      { e: '🌯', k: 'burrito' },
      { e: '🥗', k: 'salad' },
      { e: '🍝', k: 'pasta spaghetti' },
      { e: '🍜', k: 'ramen noodle' },
      { e: '🍣', k: 'sushi' },
      { e: '🍱', k: 'bento' },
      { e: '🍙', k: 'rice ball' },
      { e: '🍚', k: 'rice' },
      { e: '🍛', k: 'curry' },
      { e: '🍲', k: 'pot food' },
      { e: '🍦', k: 'ice cream' },
      { e: '🍩', k: 'donut' },
      { e: '🍪', k: 'cookie' },
      { e: '🎂', k: 'birthday cake' },
      { e: '🍰', k: 'cake' },
      { e: '🧁', k: 'cupcake' },
      { e: '🍫', k: 'chocolate' },
      { e: '🍬', k: 'candy' },
      { e: '🍭', k: 'lollipop' },
      { e: '☕', k: 'coffee' },
      { e: '🍵', k: 'tea' },
      { e: '🍺', k: 'beer' },
      { e: '🍷', k: 'wine' },
      { e: '🍾', k: 'champagne' },
      { e: '🥂', k: 'cheers toast' },
      { e: '🥃', k: 'whiskey' },
      { e: '🍸', k: 'cocktail' },
      { e: '🧊', k: 'ice' },
    ],
  },
  {
    id: 'activity',
    icon: '⚽',
    label: 'Activity',
    emojis: [
      { e: '⚽', k: 'soccer football' },
      { e: '🏀', k: 'basketball' },
      { e: '🏈', k: 'american football' },
      { e: '⚾', k: 'baseball' },
      { e: '🎾', k: 'tennis' },
      { e: '🏐', k: 'volleyball' },
      { e: '🏉', k: 'rugby' },
      { e: '🎱', k: 'pool 8 ball' },
      { e: '🏓', k: 'pingpong' },
      { e: '🏸', k: 'badminton' },
      { e: '🥊', k: 'boxing' },
      { e: '🥋', k: 'martial arts' },
      { e: '🎯', k: 'target dart' },
      { e: '⛳', k: 'golf' },
      { e: '🎣', k: 'fishing' },
      { e: '🎮', k: 'video game' },
      { e: '🕹️', k: 'joystick' },
      { e: '🎲', k: 'dice' },
      { e: '🧩', k: 'puzzle' },
      { e: '🎨', k: 'art palette' },
      { e: '🎭', k: 'theater mask' },
      { e: '🎼', k: 'music score' },
      { e: '🎤', k: 'mic' },
      { e: '🎧', k: 'headphone' },
      { e: '🎵', k: 'note music' },
      { e: '🎶', k: 'notes music' },
      { e: '🎷', k: 'sax' },
      { e: '🎸', k: 'guitar' },
      { e: '🎺', k: 'trumpet' },
      { e: '🎻', k: 'violin' },
      { e: '🥁', k: 'drum' },
      { e: '🏆', k: 'trophy win' },
      { e: '🏅', k: 'medal' },
      { e: '🥇', k: 'gold first' },
      { e: '🥈', k: 'silver second' },
      { e: '🥉', k: 'bronze third' },
    ],
  },
  {
    id: 'travel',
    icon: '✈️',
    label: 'Travel',
    emojis: [
      { e: '🚗', k: 'car' },
      { e: '🚕', k: 'taxi' },
      { e: '🚙', k: 'suv' },
      { e: '🚌', k: 'bus' },
      { e: '🚎', k: 'trolleybus' },
      { e: '🏎️', k: 'racing car' },
      { e: '🚓', k: 'police car' },
      { e: '🚑', k: 'ambulance' },
      { e: '🚒', k: 'fire truck' },
      { e: '🛻', k: 'pickup' },
      { e: '🚚', k: 'truck' },
      { e: '🚛', k: 'big truck' },
      { e: '🚜', k: 'tractor' },
      { e: '🛵', k: 'scooter' },
      { e: '🏍️', k: 'motorcycle' },
      { e: '🚲', k: 'bike' },
      { e: '🛴', k: 'kick scooter' },
      { e: '🛹', k: 'skateboard' },
      { e: '🚂', k: 'train steam' },
      { e: '🚆', k: 'train' },
      { e: '🚇', k: 'metro subway' },
      { e: '🚊', k: 'tram' },
      { e: '🚝', k: 'monorail' },
      { e: '✈️', k: 'airplane' },
      { e: '🛫', k: 'takeoff' },
      { e: '🛬', k: 'landing' },
      { e: '🚀', k: 'rocket launch' },
      { e: '🛸', k: 'ufo' },
      { e: '🚁', k: 'helicopter' },
      { e: '🛥️', k: 'motor boat' },
      { e: '⛵', k: 'sailboat' },
      { e: '🚢', k: 'ship' },
      { e: '⚓', k: 'anchor' },
      { e: '🏖️', k: 'beach' },
      { e: '🏝️', k: 'island' },
      { e: '🏔️', k: 'mountain snow' },
      { e: '🗻', k: 'fuji' },
      { e: '🏕️', k: 'camping' },
      { e: '🌋', k: 'volcano' },
      { e: '🗺️', k: 'world map' },
      { e: '🧭', k: 'compass' },
      { e: '🌍', k: 'earth africa' },
      { e: '🌎', k: 'earth america' },
      { e: '🌏', k: 'earth asia' },
    ],
  },
  {
    id: 'objects',
    icon: '💡',
    label: 'Objects',
    emojis: [
      { e: '⌚', k: 'watch' },
      { e: '📱', k: 'phone mobile' },
      { e: '💻', k: 'laptop' },
      { e: '⌨️', k: 'keyboard' },
      { e: '🖥️', k: 'desktop computer' },
      { e: '🖨️', k: 'printer' },
      { e: '🖱️', k: 'mouse computer' },
      { e: '🕹️', k: 'joystick' },
      { e: '💾', k: 'floppy save' },
      { e: '💿', k: 'cd disc' },
      { e: '📀', k: 'dvd' },
      { e: '📷', k: 'camera' },
      { e: '📹', k: 'video camera' },
      { e: '🎥', k: 'movie camera' },
      { e: '📺', k: 'tv television' },
      { e: '📡', k: 'satellite dish' },
      { e: '🔋', k: 'battery' },
      { e: '🔌', k: 'plug' },
      { e: '💡', k: 'bulb idea' },
      { e: '🔦', k: 'flashlight' },
      { e: '🕯️', k: 'candle' },
      { e: '🪔', k: 'oil lamp' },
      { e: '🧯', k: 'fire extinguisher' },
      { e: '🛢️', k: 'oil drum' },
      { e: '💸', k: 'money fly' },
      { e: '💵', k: 'dollar' },
      { e: '💴', k: 'yen' },
      { e: '💶', k: 'euro' },
      { e: '💷', k: 'pound' },
      { e: '💰', k: 'money bag' },
      { e: '💳', k: 'credit card' },
      { e: '💎', k: 'diamond gem' },
      { e: '⚖️', k: 'balance scale' },
      { e: '🔧', k: 'wrench tool' },
      { e: '🔨', k: 'hammer' },
      { e: '🛠️', k: 'tools' },
      { e: '⛏️', k: 'pickaxe mine' },
      { e: '🪓', k: 'axe' },
      { e: '🔑', k: 'key' },
      { e: '🔒', k: 'lock closed' },
      { e: '🔓', k: 'lock open' },
      { e: '🔔', k: 'bell notification' },
      { e: '🔕', k: 'bell mute' },
      { e: '🎁', k: 'gift present' },
      { e: '📦', k: 'package box' },
      { e: '📨', k: 'envelope' },
      { e: '📧', k: 'email mail' },
      { e: '📝', k: 'note memo' },
      { e: '📋', k: 'clipboard' },
      { e: '📌', k: 'pin' },
      { e: '🔗', k: 'link chain' },
      { e: '📎', k: 'paperclip' },
      { e: '✂️', k: 'scissors' },
      { e: '📐', k: 'ruler' },
      { e: '📏', k: 'straight ruler' },
      { e: '🗂️', k: 'folder file' },
      { e: '📁', k: 'folder' },
      { e: '📂', k: 'folder open' },
      { e: '📄', k: 'document page' },
      { e: '📃', k: 'page curl' },
      { e: '📊', k: 'chart bar' },
      { e: '📈', k: 'chart up' },
      { e: '📉', k: 'chart down' },
      { e: '📚', k: 'books' },
      { e: '📖', k: 'open book' },
      { e: '🔬', k: 'microscope' },
      { e: '🔭', k: 'telescope' },
      { e: '🧪', k: 'test tube' },
      { e: '🧬', k: 'dna' },
      { e: '💊', k: 'pill medicine' },
      { e: '💉', k: 'syringe' },
      { e: '🩺', k: 'stethoscope' },
    ],
  },
  {
    id: 'symbols',
    icon: '❤️',
    label: 'Symbols',
    emojis: [
      { e: '❤️', k: 'red heart love' },
      { e: '🧡', k: 'orange heart' },
      { e: '💛', k: 'yellow heart' },
      { e: '💚', k: 'green heart' },
      { e: '💙', k: 'blue heart' },
      { e: '💜', k: 'purple heart' },
      { e: '🖤', k: 'black heart' },
      { e: '🤍', k: 'white heart' },
      { e: '🤎', k: 'brown heart' },
      { e: '💔', k: 'broken heart' },
      { e: '❣️', k: 'heart exclamation' },
      { e: '💕', k: 'two hearts' },
      { e: '💞', k: 'revolving hearts' },
      { e: '💓', k: 'beating heart' },
      { e: '💗', k: 'growing heart' },
      { e: '💖', k: 'sparkling heart' },
      { e: '💘', k: 'heart arrow' },
      { e: '💝', k: 'heart ribbon gift' },
      { e: '💟', k: 'heart decoration' },
      { e: '☮️', k: 'peace' },
      { e: '✝️', k: 'cross' },
      { e: '☪️', k: 'star crescent' },
      { e: '🕉️', k: 'om' },
      { e: '☸️', k: 'dharma' },
      { e: '✡️', k: 'star david' },
      { e: '☯️', k: 'yin yang' },
      { e: '♈', k: 'aries' },
      { e: '♉', k: 'taurus' },
      { e: '♊', k: 'gemini' },
      { e: '♋', k: 'cancer' },
      { e: '♌', k: 'leo' },
      { e: '♍', k: 'virgo' },
      { e: '♎', k: 'libra' },
      { e: '♏', k: 'scorpio' },
      { e: '♐', k: 'sagittarius' },
      { e: '♑', k: 'capricorn' },
      { e: '♒', k: 'aquarius' },
      { e: '♓', k: 'pisces' },
      { e: '🆔', k: 'id' },
      { e: '⚛️', k: 'atom' },
      { e: '☢️', k: 'radioactive' },
      { e: '☣️', k: 'biohazard' },
      { e: '📵', k: 'no phone' },
      { e: '🔞', k: '18+' },
      { e: '⭕', k: 'circle red' },
      { e: '❌', k: 'x cross wrong' },
      { e: '❎', k: 'x button' },
      { e: '✅', k: 'check correct' },
      { e: '☑️', k: 'check box' },
      { e: '✔️', k: 'check mark' },
      { e: '❓', k: 'question' },
      { e: '❔', k: 'white question' },
      { e: '❕', k: 'white exclamation' },
      { e: '❗', k: 'exclamation' },
      { e: '〽️', k: 'part alternation' },
      { e: '⚠️', k: 'warning' },
      { e: '🚸', k: 'children crossing' },
      { e: '🔱', k: 'trident' },
      { e: '⚜️', k: 'fleur de lis' },
      { e: '🔰', k: 'beginner' },
      { e: '♻️', k: 'recycle' },
      { e: '⚙️', k: 'gear settings' },
      { e: '🎉', k: 'tada party' },
      { e: '🎊', k: 'confetti ball' },
      { e: '🎈', k: 'balloon' },
      { e: '🔥', k: 'fire hot' },
      { e: '✨', k: 'sparkles' },
      { e: '⭐', k: 'star' },
      { e: '🌟', k: 'glowing star' },
      { e: '💫', k: 'dizzy star' },
      { e: '💥', k: 'collision boom' },
      { e: '💢', k: 'anger' },
      { e: '💦', k: 'sweat drops' },
      { e: '💨', k: 'dash wind' },
      { e: '💤', k: 'zzz sleep' },
    ],
  },
];

/** Quick row trên cùng — emoji dùng nhiều nhất, người dùng có thể skip search. */
const QUICK = ['👍', '❤️', '😂', '🎉', '🤔', '😢', '🔥', '👏'];

type Props = {
  /** Callback khi user chọn 1 emoji. */
  onSelect: (emoji: string) => void;
  /** Callback khi user bấm X hoặc Esc. Optional — caller có thể dùng outside-click. */
  onClose?: () => void;
  /** Auto-focus search input. Default true cho desktop, false cho touch (mobile keyboard). */
  autoFocus?: boolean;
};

export function EmojiPicker({ onSelect, onClose, autoFocus = true }: Props) {
  const [query, setQuery] = React.useState('');
  const [activeId, setActiveId] = React.useState<string>(CATEGORIES[0]!.id);

  // Filter mode: nếu query có text → flatten cross-category, ẩn tab nav.
  const filtered = React.useMemo(() => {
    if (!query.trim()) return null;
    const q = query.toLowerCase().trim();
    const out: { e: string; k: string }[] = [];
    for (const cat of CATEGORIES) {
      for (const em of cat.emojis) {
        if (em.k.includes(q)) out.push(em);
      }
    }
    return out;
  }, [query]);

  const activeCategory = CATEGORIES.find((c) => c.id === activeId)!;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="flex h-[360px] w-[340px] flex-col overflow-hidden rounded-xl border border-divider bg-popover shadow-elevated"
      role="dialog"
      aria-label="Chọn emoji"
    >
      {/* Header — search + close */}
      <header className="flex shrink-0 items-center gap-1 border-b px-2 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tìm emoji…"
            autoFocus={autoFocus}
            className="w-full rounded-md border border-input bg-background py-1.5 pl-7 pr-2 text-[12.5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </header>

      {/* Quick row — chỉ hiện khi không search */}
      {!filtered && (
        <div className="shrink-0 border-b px-2 py-1.5">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Hay dùng
          </div>
          <div className="flex flex-wrap gap-0.5">
            {QUICK.map((e) => (
              <EmojiButton key={e} emoji={e} onClick={() => onSelect(e)} />
            ))}
          </div>
        </div>
      )}

      {/* Body — grid emoji */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {filtered ? (
          filtered.length === 0 ? (
            <p className="py-8 text-center text-[11px] text-muted-foreground">
              Không có emoji khớp &quot;{query}&quot;
            </p>
          ) : (
            <div className="flex flex-wrap gap-0.5">
              {filtered.map((em) => (
                <EmojiButton key={em.e + em.k} emoji={em.e} onClick={() => onSelect(em.e)} />
              ))}
            </div>
          )
        ) : (
          <>
            <div className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {activeCategory.label}
            </div>
            <div className="flex flex-wrap gap-0.5">
              {activeCategory.emojis.map((em) => (
                <EmojiButton key={em.e + em.k} emoji={em.e} onClick={() => onSelect(em.e)} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer — tab nav (ẩn khi search) */}
      {!filtered && (
        <nav
          className="flex shrink-0 items-center justify-between border-t px-1 py-1"
          aria-label="Category"
        >
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveId(c.id)}
              aria-label={c.label}
              title={c.label}
              className={cn(
                'inline-flex h-7 w-7 items-center justify-center rounded-md text-base transition-all',
                activeId === c.id
                  ? 'bg-primary/10 ring-1 ring-inset ring-primary/30'
                  : 'opacity-60 hover:bg-muted hover:opacity-100',
              )}
            >
              <span>{c.icon}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

function EmojiButton({ emoji, onClick }: { emoji: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[18px] transition-transform hover:scale-110 hover:bg-muted"
    >
      <span>{emoji}</span>
    </button>
  );
}
