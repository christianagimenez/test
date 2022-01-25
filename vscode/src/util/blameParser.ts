"use babel";

import { BlameCommit } from "../../../common/src/model/notebook-dom";

export class BlameParser {
  constructor(private readonly gitUserName: string, private readonly gitEmail: string) {
    this.parseBlameLine = this.parseBlameLine.bind(this);
  }
  /**
   * Parses the git commit revision from blame data for a line of code.
   *
   * @param {string} line - the blame data for a particular line of code
   * @return {string} - the git revision hash string.
   */
  private parseRevision(line: string): string | undefined {
    const revisionRegex = /^\w+/;
    const match = line.match(revisionRegex);
    return match ? match[0] : undefined;
  }

  /**
   * Parses the author name from blame data for a line of code.
   *
   * @param {string} line - the blame data for a particular line of code
   * @return {string} - the author name for that line of code.
   */
  private parseAuthor(line: string): string | undefined {
    const committerMatcher = /^author\s(.*)$/m;
    const match = line.match(committerMatcher);
    return match && match.length > 1 ? match[1] : undefined;
  }

  /**
   * Parses the author email from blame data for a line of code.
   *
   * @param {string} line - the blame data for a particular line of code
   * @return {string} - the author email for that line of code.
   */
  private parseAuthorEmail(line: string): string | undefined {
    const committerMatcher = /^author-mail\s<(.*)>$/m;
    const match = line.match(committerMatcher);
    return match && match.length > 1 ? match[1] : undefined;
  }

  /**
   * Parses the commit date from blame data for a line of code.
   *
   * @param {string} line - the blame data for a particular line of code
   * @return {string} - human readable date string of the lines commit date
   */
  private parseCommitterDate(line: string): number | undefined {
    const dateMatcher = /^committer-time\s(.*)$/m;
    const match = line.match(dateMatcher);
    if (!match || match.length < 2) {
      return undefined;
    }
    const dateStamp = match[1];
    return parseInt(dateStamp);
  }

  /**
   * Parses the summary line from the blame data for a line of code
   *
   * @param {string} line - the blame data for a particular line of code
   * @return {string} - the summary line for the last commit for a line of code
   */
  private parseSummary(line: string): string | undefined {
    const summaryMatcher = /^summary\s(.*)$/m;
    const match = line.match(summaryMatcher);
    return match && match.length > 1 ? match[1] : undefined;
  }

  /**
   * Parses the blame --line-porcelain output for a particular line of code into a
   * usable object with properties:
   *
   * sha: string;
   * name: string;
   * email: string; // in WORST case, it could be "" (empty string)
   * timestamp: number (committed, seconds since epoch)
   * blameLines: number[];
   * commitMessage: string;
   *
   * @param {string} blameData - the blame --porcelain output for a line of code
   * @param {number} index - the index that the data appeared in an array of line
   *    line data (0 indexed)
   * @return {object} - an object with properties described above
   */
  private parseBlameLine(blameData: string, index: number): BlameCommit {
    const lineNumber = index + 1;
    const output: Partial<BlameCommit> = {};
    const sha = this.parseRevision(blameData);
    if (!sha) {
      throw new Error(`failed to parse revision from blame line ${lineNumber}`);
    }
    output.sha = sha;

    const name = this.parseAuthor(blameData);
    if (!name) {
      throw new Error(`failed to parse author from blame line ${lineNumber}`);
    }
    output.name = name;

    const timestamp = this.parseCommitterDate(blameData);
    if (!timestamp) {
      throw new Error(`failed to parse committer timestamp from blame line ${lineNumber}`);
    }
    output.timestamp = timestamp;

    const commitMessage = this.parseSummary(blameData);
    if (!commitMessage) {
      throw new Error(`failed to parse commit summary from blame line ${lineNumber}`);
    }
    output.commitMessage = commitMessage;

    const email = this.parseAuthorEmail(blameData);
    if (!email) {
      throw new Error(`failed to parse author email from blame line ${lineNumber}`);
    }
    output.email = email;

    // If the change is not committed, substitute the "Not Committed Yet"
    // values with the local git users' details.
    if (!this.isCommitted(sha)) {
      output.name = this.gitUserName;
      output.email = this.gitEmail;
    }

    output.blameLines = [lineNumber];

    return output as BlameCommit;
  }

  /**
   * Returns whether the supplied sha is committed or not
   *
   * @param {object} sha - parsed sha for a line
   */
  private isCommitted(sha: string) {
    return !/^0*$/.test(sha);
  }

  /**
   * Parses git-blame output into usable array of info objects.
   *
   * @param {string} blameOutput - output from 'git blame --porcelain <file>'
   */
  parseBlame(rawBlameData: string) {
    // Matches new lines only when followed by a line with commit hash info that
    // are followed by autor line. This is the 1st and 2nd line of the blame
    // --porcelain output.
    const singleLineDataSplitRegex = /\n(?=\w+\s(?:\d+\s)+\d+\nauthor)/g;

    // Split the blame output into data for each line and parse out desired
    // data from each into an object.
    return rawBlameData.split(singleLineDataSplitRegex).map(this.parseBlameLine);
  }
}
