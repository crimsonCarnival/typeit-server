import { generate } from 'random-words';

const PUNCTUATION_MARKS = ['.', ',', '!', '?', ';', ':'];
const NUMBERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * Adds random punctuation to a word (at the end).
 * @param {string} word - The word to modify
 * @returns {string} Word with punctuation
 */
const addPunctuation = (word) => {
  const mark = PUNCTUATION_MARKS[Math.floor(Math.random() * PUNCTUATION_MARKS.length)];
  return word + mark;
};

/**
 * Generates a random number string of variable length (1-4 digits).
 * @returns {string} Random number string
 */
const generateNumberString = () => {
  const length = Math.floor(Math.random() * 4) + 1;
  let result = '';
  for (let i = 0; i < length; i++) {
    result += NUMBERS[Math.floor(Math.random() * NUMBERS.length)];
  }
  return result;
};

/**
 * Generates a space-separated string of random words using random-words library.
 * @param {number} count - Number of words to generate
 * @param {Object} options - Generation options
 * @param {boolean} options.punctuation - Add random punctuation
 * @param {boolean} options.numbers - Add random numbers
 * @returns {string} Space-separated word string
 */
const generateWordContent = (count = 50, options = {}) => {
  const { punctuation = false, numbers = false } = options;
  if (!count || count < 1) count = 50;
  
  // Generate words using random-words library
  const words = generate({ exactly: count, maxLength: 8 });
  const picked = [];
  
  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    
    if (punctuation && Math.random() < 0.15) {
      word = addPunctuation(word);
    }
    
    picked.push(word);
    
    if (numbers && Math.random() < 0.1) {
      picked.push(generateNumberString());
    }
  }
  
  return picked.join(' ');
};

export { generateWordContent };
